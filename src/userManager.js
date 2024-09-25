const core = require('@actions/core')
// const github = require('@actions/github')
const { hold_until_rate_limit_success } = require('./rateLimit')

// IMPORTANT
//   Enterprise API Docs: https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin?apiVersion=2022-11-28
//   These endpoints only support authentication using a personal access token (classic). For more information, see "Managing your personal access tokens."

class UserManager {
  constructor(token) {
    this.token = token
  }

  async init() {
    if (this.graphql) {
      return
    }

    // ignore import/no-unresolved for dynamic imports
    // eslint-disable-next-line import/no-unresolved
    const Octokit = await import('@octokit/core')
    // eslint-disable-next-line import/no-unresolved
    const paginateGraphQL = await import('@octokit/plugin-paginate-graphql')
    // eslint-disable-next-line import/no-unresolved
    const paginateRest = await import('@octokit/plugin-paginate-rest')
    const NewOctokit = Octokit.Octokit.plugin(
      paginateGraphQL.paginateGraphQL,
      paginateRest.paginateRest
    )

    this.octokit = new NewOctokit({ auth: this.token })
    this.graphql = this.octokit.graphql

    // no point in starting if we can't get the rate limit
    await hold_until_rate_limit_success(100, this.token)
  }

  async getAllOrganizationsInEnterprise(ent) {
    await this.init()

    const query = `
        query($ent: String!, $cursor: String) {
        enterprise(slug: $ent) {
            organizations(first: 100, after: $cursor) {
            nodes {
                login
                id
                url
            }
            totalCount
            pageInfo {
                hasNextPage
                endCursor
                }
            }
        }
        }
            `

    try {
      const all = []
      const iterator = await this.graphql.paginate.iterator(query, { ent })
      let page_check_done = false

      for await (const result of iterator) {
        const orgs = result.enterprise.organizations.nodes
        all.push(...orgs)

        // perform a rate limit check if there are more pages
        if (
          !page_check_done &&
          result.enterprise.organizations.pageInfo.hasNextPage
        ) {
          const totalCount = result.enterprise.organizations.totalCount
          core.info(`${totalCount} total orgs. Performing rate limit check...`)

          const totalCalls = Math.ceil(totalCount / 100)
          await hold_until_rate_limit_success(totalCalls + 10, this.token)
          page_check_done = true
        }
      }

      return all
    } catch (error) {
      core.error(`Error fetching organizations for '${ent}':`, error)
      throw error
    }
  }

  async getConsumedLicenses(ent) {
    await this.init()

    try {
      const page_size = 100
      const users = []
      let page_check_done = false

      for await (const response of this.octokit.paginate.iterator(
        `GET /enterprises/${ent}/consumed-licenses`,
        {
          per_page: page_size
        }
      )) {
        users.push(...response.data.users)

        // perform a rate limit check after the first page
        if (
          !page_check_done &&
          response.data.total_seats_consumed > page_size
        ) {
          core.info(
            `${response.data.total_seats_consumed} total users. Performing rate limit check...`
          )

          const totalCalls = Math.ceil(
            response.data.total_seats_consumed / page_size
          )
          await hold_until_rate_limit_success(
            totalCalls + 10,
            this.token,
            response.headers
          )
          page_check_done = true
        }
      }

      return users
    } catch (error) {
      console.error('Error fetching users consuming licenses:', error)
      throw error
    }
  }

  async getAllUserIdsInOrganization(org) {
    await this.init()

    const query = `
        query($org: String!, $cursor: String) {
        organization(login: $org) {
            membersWithRole(first: 100, after: $cursor) {
                nodes {
                    login
                }
                totalCount
                pageInfo {
                    hasNextPage
                    endCursor
                    }
                }
            }
        }`

    try {
      const all = []
      const iterator = await this.graphql.paginate.iterator(query, { org })

      let page_check_done = false

      for await (const result of iterator) {
        const logins = result.organization.membersWithRole.nodes.map(
          node => node.login
        )
        all.push(...logins)

        // perform a rate limit check if there are more pages
        if (
          !page_check_done &&
          result.organization.membersWithRole.pageInfo.hasNextPage
        ) {
          const totalCount = result.organization.membersWithRole.totalCount
          core.info(`${totalCount} total users. Performing rate limit check...`)

          const totalCalls = Math.ceil(totalCount / 100)
          await hold_until_rate_limit_success(totalCalls + 10, this.token)
          page_check_done = true
        }
      }

      return all
    } catch (error) {
      core.error('Error fetching users in organizations:', error)
      throw error
    }
  }

  async getOrgsAndTeamsForUser(username, enterprise, orgFilter) {
    await this.init()

    // TODO - this returns all organizations, not just the ones in the enterprise
    // contributionsCollection should work for last activity? https://docs.github.com/en/graphql/reference/objects#contributionscollection

    // TODO check if createdAt is needed - original script has it
    const query = `
  query($username: String!, $cursor: String) {
    user(login: $username) {
      contributionsCollection  {
        endedAt
      }
      createdAt
      organizations(first: 100, after: $cursor) {
        edges {
          node {
            login
            name
            description
            teams(first: 100, userLogins: [$username]) {
                edges {
                    node {
                        name
                        slug
                        description
                    }
                }
                totalCount
                pageInfo {
                    endCursor
                    hasNextPage
                }
            }
          }
        }
        totalCount
        pageInfo {
           endCursor
           hasNextPage
        }
      }
    }
  }`

    try {
      const all = []
      const iterator = await this.graphql.paginate.iterator(query, {
        username
      })

      for await (const result of iterator) {
        const hasMoreOrgs = result.user.organizations.pageInfo.hasNextPage

        if (hasMoreOrgs) {
          core.debug(
            `User ${username} is a member of more than 100 organizations. Results will be paged.`
          )

          // todo - perform a rate limit check if there are more pages ?
        }

        for (const org of result.user.organizations.edges) {
          if (orgFilter && !orgFilter(org.node.login)) {
            core.warning(
              `⚠️ Skipping org ${org.node.login} as it is not in the enterprise`
            )
            continue
          }

          const orgResult = {
            org: {
              login: org.node.login,
              name: org.node.name,
              description: org.node.description
            },
            teams: org.node.teams.edges.map(edge => edge.node)
          }

          const hasMoreTeams = org.node.teams.pageInfo.hasNextPage
          if (hasMoreTeams) {
            const teams = await this.getMoreTeamsForUser(
              username,
              org.node.login,
              org.node.teams.pageInfo.endCursor
            )
            orgResult.teams.push(...teams)
          }

          all.push(orgResult)
        }
      }

      // remove orgs that are not in the enterprise
      return all
    } catch (error) {
      core.error(
        `Error fetching teams and orgs for a user : ${username}`,
        error
      )
      throw error
    }
  }

  async getMoreTeamsForUser(username, org, cursor) {
    await this.init()

    const query = `
    query($username: String!, $org: String!, $cursor: String) {
        organization(login: $org) {
            teams(first: 100, after: $cursor, userLogins: [$username]) {
                nodes {
                    name
                    slug
                    description
                }
                totalCount
                pageInfo {
                    endCursor
                    hasNextPage
                }
            }
        }
    }`

    try {
      const all = []
      const iterator = await this.graphql.paginate.iterator(query, {
        username,
        org,
        cursor
      })

      let page_check_done = false

      for await (const result of iterator) {
        const teams = result.organization.teams.nodes
        all.push(...teams)

        // perform a rate limit check if there are more pages
        if (
          !page_check_done &&
          result.organization.teams.pageInfo.hasNextPage
        ) {
          const totalCount = result.organization.teams.totalCount
          core.info(
            `${totalCount} total teams for ${username} in ${org} org. Performing rate limit check...`
          )

          const totalCalls = Math.ceil(totalCount / 100)
          await hold_until_rate_limit_success(totalCalls + 10, this.token)
          page_check_done = true
        }
      }

      return all
    } catch (error) {
      core.error(`Error fetching teams for ${username} in ${org} org:`, error)
      throw error
    }
  }

  async getLastActivityForUser(username, ent) {
    await this.init()

    try {
      const date = new Date().toISOString().split('T')[0]
      const phrase = `created:<=${date} actor:${username}`
      const encodedPhrase = encodeURIComponent(phrase)

      const response = await this.octokit.request(
        `GET /enterprises/${ent}/audit-log?per_page=1&phrase=${encodedPhrase}`
      )

      // perform a rate limit check by reading X-RateLimit-Remaining header
      const remaining = parseInt(response.headers['x-ratelimit-remaining'])
      core.info(
        `Audit Log API has a rate limit of 1,750 queries per hour per user and IP address. Rate limit check - ${remaining} remaining`
      )
      if (remaining < 25) {
        core.info('Rate limit approaching, waiting for 5 minutes...')
        await new Promise(resolve => setTimeout(resolve, 5 * 60000))
      }

      if (response.data.length === 0) {
        // no activity found
        return null
      }

      const unixTimestamp = response.data[0]['@timestamp']
      return new Date(unixTimestamp)
    } catch (error) {
      core.error(
        `Error fetching last activity for ${username} in '${ent}' enterprise.`,
        error
      )
      throw error
    }
  }

  async getLast50PagesOfAuditLog(ent, pages = 50) {
    // This endpoint has a rate limit of 1,750 queries per hour per user and IP address. If your integration receives a rate limit error (typically a 403 or 429 response)

    // make direct call to the API
    await this.init()
    const userDict = {}
    const phrase =
      'action:user -actor:github-actions[bot] -actor:dependabot[bot] -action:org.register_self_hosted_runner -action:workflows'
    const encodedPhrase = encodeURIComponent(phrase)

    try {
      for (let page = 1; page < pages; page++) {
        // const response = await this.octokit.request(`GET /enterprises/${ent}/audit-log?phrase=created:<=${date}&include=all&per_page=100&page=${page}`);
        const response = await this.octokit.request(
          `GET /enterprises/${ent}/audit-log?per_page=100&page=${page}&phrase=${encodedPhrase}`
        )

        const events = response.data
        for (const event of events) {
          const actor = event.actor

          if (!actor) {
            core.warning(`Event ${event.id} has no actor`)
            continue
          }

          if (!userDict[actor]) {
            // convert UNIX timestamp to human readable date
            const unixTimestamp = event['@timestamp']
            const date = new Date(unixTimestamp)
            userDict[actor] = date
          }
        }

        // check if there are more pages
        if (events.length < 100) {
          break
        }

        // perform a rate limit check by reading X-RateLimit-Remaining header
        const remaining = parseInt(response.headers['x-ratelimit-remaining'])
        core.info(
          `Audit Log API has a rate limit of 1,750 queries per hour per user and IP address. Rate limit check after ${page} pages - ${remaining} remaining`
        )
        if (remaining < 10) {
          core.info('Rate limit approaching, waiting for 60 seconds...')
          await new Promise(resolve => setTimeout(resolve, 60000))
        }
      }

      return userDict
    } catch (error) {
      core.error(`Error fetching audit log in '${ent}' enterprise.`, error)
      throw error
    }
  }
}

module.exports = { UserManager }
