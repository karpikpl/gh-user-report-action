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
                name
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
      core.error(`Error fetching organizations for ${ent}:`, error)
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

        // check if there are more teams to fetch
        for (const org of result.user.organizations.edges) {
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
            core.warning(
              `User ${username} is a member of more than 2 teams in organization ${org.node.login}. This script only supports 2 teams.`
            )

            const teams = await this.getMoreTeamsForUser(
              username,
              org.node.login,
              org.node.teams.pageInfo.endCursor
            )
            orgResult.teams.push(...teams)
          }

          if (orgFilter && !orgFilter(org.node.login)) {
            core.warning(
              `Skipping org ${org.node.login} as it is not in the enterprise`
            )
            continue
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

  async getLastActivityForUser(username) {
    // TODO call "https://api.github.com/users/$($_.github_com_login)/events" or use contributionsCollection.endedAt ?
    'https://api.github.com/enterprises/$enterprise/audit-log?phrase=created:<=$today+actor:$userName&include=all'
  }

  async getAuditForUser(username, ent) {
    // TODO call "https://api.github.com/enterprises/$enterprise/audit-log?phrase=created:<=$today+actor:$userName&include=all"
    // TODO - add per_page=1 if we only need the latest event ?
    // This endpoint has a rate limit of 1,750 queries per hour per user and IP address. If your integration receives a rate limit error (typically a 403 or 429 response)
  }
}

module.exports = { UserManager }
