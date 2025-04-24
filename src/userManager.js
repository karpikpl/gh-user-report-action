const core = require('@actions/core')
// const github = require('@actions/github')
const { hold_until_rate_limit_success } = require('./rateLimit')

// IMPORTANT
//   Enterprise API Docs: https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin?apiVersion=2022-11-28
//   These endpoints only support authentication using a personal access token (classic). For more information, see "Managing your personal access tokens."

/**
 * The UserManager class.
 * @class
 * @classdesc A class for managing users.
 * @property {string} token The GitHub token.
 */
class UserManager {
  constructor(token) {
    this.token = token
  }

  /**
   * Initialize the UserManager.
   * @returns {Promise<void>} Resolves when the UserManager is initialized.
   * @async
   * @function
   * @instance
   * @memberof UserManager
   * @name init
   * @access protected
   */
  async #init() {
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

  /**
   * Get all organizations in an enterprise.
   * @param {string} ent The enterprise name.
   * @returns {Promise<Array<{login: string, id: string, url: string}>>} The organizations in the enterprise.
   * @async
   * @function
   * @instance
   * @memberof UserManager
   * @name getAllOrganizationsInEnterprise
   * @access public
   * @throws {Error} Throws an error if there is an issue fetching the organizations.
   */
  async getAllOrganizationsInEnterprise(ent) {
    await this.#init()

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
      /**
       * @type {Array<{login: string, id: string, url: string}>}
       */
      const all = []
      const iterator = this.graphql.paginate.iterator(query, { ent })
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
      core.error(`Error fetching organizations for '${ent}'`)
      throw error
    }
  }

  /**
   * Get all users consuming licenses in an enterprise.
   * @param {string} ent The enterprise name.
   * @returns {Promise<Array<{
   * github_com_login : string,
   * github_com_name: string?,
   * enterprise_server_user_ids : Array<string>,
   * github_com_user : boolean,
   * enterprise_server_user: boolean?,
   * visual_studio_subscription_user : boolean,
   * license_type : string,
   * github_com_profile: string?,
   * github_com_member_roles : Array<string>,
   * github_com_enterprise_roles : Array<string>,
   * github_com_verified_domain_emails : Array<string>,
   * github_com_saml_name_id: string?,
   * github_com_orgs_with_pending_invites : Array<string>,
   * github_com_two_factor_auth: boolean?,
   * enterprise_server_emails : Array<string>,
   * visual_studio_license_status: string?,
   * visual_studio_subscription_email: string?,
   * total_user_accounts : integer
   * }>>} The users consuming licenses in the enterprise.
   * @async
   * @function
   * @instance
   * @memberof UserManager
   * @name getConsumedLicenses
   * @access public
   * @throws {Error} Throws an error if there is an issue fetching the users.
   */
  async getConsumedLicenses(ent) {
    await this.#init()

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
      core.error(`Error fetching users consuming licenses in '${ent}'`)
      throw error
    }
  }

  /**
   * Get all teams for a user in an enterprise. Returns only teams from the organizations that are in the enterprise.
   * In case of an error, it will return an empty array.
   * @param {string} username The GitHub username.
   * @param {string} enterprise The enterprise name.
   * @returns {Promise<{orgs: Array<{org: {login: string, name: string, description: string}, teams: Array<{name: string, slug: string, description: string}>}}>} The organizations and teams for the user.
   * @async
   * @function
   * @instance
   * @memberof UserManager
   * @name getTeamsForUser
   * @access public
   */
  async getTeamsForUser(username, enterprise) {
    await this.#init()

    core.info(`Getting teams for ${username} in ${enterprise}`)
    // TODO - this returns all organizations, not just the ones in the enterprise
    const query = `
query($ent: String!, $cursor: String, $username: String!) {
enterprise(slug: $ent) {
    organizations(first: 100, after: $cursor) {
    nodes {
        name
        description
        login
        id
        url
        teams(first: 100, userLogins: [$username]) {
          edges {
            node {
              name
              slug
              description
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
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
      /**
       * @type { orgs: Array<{org: {login: string, name: string, description: string}, teams: Array<{name: string, slug: string, description: string}>}>}
       */
      const userWithOrgs = { orgs: [] }
      const iterator = await this.graphql.paginate.iterator(query, {
        ent: enterprise,
        username
      })

      for await (const result of iterator) {
        const hasMoreOrgs = result.enterprise.organizations.pageInfo.hasNextPage

        if (hasMoreOrgs) {
          core.debug(
            `User ${username} is a member of more than 100 organizations. Results will be paged.`
          )

          // todo - perform a rate limit check if there are more pages ?
        }

        for (const org of result.enterprise.organizations.nodes) {
          const orgResult = {
            org: {
              login: org.login,
              name: org.name,
              description: org.description
            },
            teams: org.teams.edges.map(edge => edge.node)
          }

          const hasMoreTeams = org.teams.pageInfo.hasNextPage
          if (hasMoreTeams) {
            const teams = await this.getMoreTeamsForUser(
              username,
              org.login,
              org.teams.pageInfo.endCursor
            )
            orgResult.teams.push(...teams)
          }

          userWithOrgs.orgs.push(orgResult)
        }
      }

      const teams_count = userWithOrgs.orgs.reduce(
        (acc, org) => acc + org.teams.length,
        0
      )
      core.info(`Found ${teams_count} teams for ${username}`)
      return userWithOrgs
    } catch (error) {
      core.error(`Error fetching teams and orgs for a user : ${username}`)
      core.error(error)
      // do not throw error, just return empty array
      return { orgs: [] }
    }
  }

  async getMoreTeamsForUser(username, org, cursor) {
    await this.#init()

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
      core.error(`Error fetching teams for ${username} in ${org} org:`)
      throw error
    }
  }

  /**
   * Get the last activity for a user in an enterprise.
   * @param {string} username the GitHub username
   * @param {string} ent the enterprise name
   * @param {boolean} sleepOnRateLimit
   * @returns {Promise<{lastActivityDate: Date, rateLimitRemaining: int}>}
   */
  async getLastActivityForUser(username, ent, sleepOnRateLimit = true) {
    await this.#init()

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
      if (remaining < 25 && sleepOnRateLimit) {
        core.info('Rate limit approaching, waiting for 5 minutes...')
        await new Promise(resolve => setTimeout(resolve, 5 * 60000))
      }

      if (response.data.length === 0) {
        // no activity found
        core.warning(
          `No activity found for ${username} in '${ent}' enterprise audit log.`
        )
        return {
          lastActivityDate: null,
          rateLimitRemaining: remaining
        }
      }

      const unixTimestamp = response.data[0]['@timestamp']
      return {
        lastActivityDate: new Date(unixTimestamp),
        rateLimitRemaining: remaining
      }
    } catch (error) {
      core.error(
        `Error fetching last activity for ${username} in '${ent}' enterprise.`
      )
      throw error
    }
  }

  /**
   * Get the last activity for a user in an enterprise.
   * @param {string} username the GitHub username
   * @param {boolean} sleepOnRateLimit
   * @returns {Promise<{userData: {login:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string}, rateLimitRemaining: int}>}
   */
  async getUser(username, sleepOnRateLimit = true) {
    await this.#init()

    try {
      const response = await this.octokit.request(`GET /users/${username}`)

      // perform a rate limit check by reading X-RateLimit-Remaining header
      const remaining = parseInt(response.headers['x-ratelimit-remaining'])
      core.info(
        `GitHub API has a rate limit of 5000 queries per hour per user and IP address. Rate limit check - ${remaining} remaining`
      )
      if (remaining < 25 && sleepOnRateLimit) {
        core.info('Rate limit approaching, waiting for 1 minute...')
        await new Promise(resolve => setTimeout(resolve, 1 * 60000))
      }

      /**
       * @type {{login:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string}}
       */
      const user = response.data
      return {
        userData: user,
        rateLimitRemaining: remaining
      }
    } catch (error) {
      core.error(`Error fetching user data for ${username}`)
      throw error
    }
  }

  /**
   * Get the copilot seats for an enterprise.
   * @param {string} ent The enterprise name.
   * @returns {Promise<Map<string, {created_at: string, updated_at: string, pending_cancellation_date: string, last_activity_at: string, last_activity_editor: string, assignee: {login: string}, assigning_team: {slug: string}, organization: {login: string}}>} The map with copilot seats for the enterprise where the key is the assignee login.
   * @async
   * @function
   * @instance
   * @memberof UserManager
   * @name getCopilotUsage
   * @access public
   * @throws {Error} Throws an error if there is an issue fetching the copilot usage.
   */
  async getCopilotSeats(ent) {
    await this.#init()

    try {
      const page_size = 100
      /**
       * @type {Array<{created_at: string, updated_at: string, pending_cancellation_date: string, last_activity_at: string, last_activity_editor: string, assignee: {login: string}, assigning_team: {slug: string}, organization: {login: string}>}
       */
      const seats = []
      let page_check_done = false

      for await (const response of this.octokit.paginate.iterator(
        `GET /enterprises/${ent}/copilot/billing/seats`,
        {
          per_page: page_size
        }
      )) {
        seats.push(...response.data.seats)

        // perform a rate limit check after the first page
        if (!page_check_done && response.data.total_seats > page_size) {
          core.info(
            `${response.data.total_seats} total seats. Performing rate limit check...`
          )

          const totalCalls = Math.ceil(response.data.total_seats / page_size)
          await hold_until_rate_limit_success(
            totalCalls + 10,
            this.token,
            response.headers
          )
          page_check_done = true
        }
      }

      // convert seats to object
      const map = new Map(seats.map(seat => [seat.assignee.login, seat]))
      return map
    } catch (error) {
      core.error(`Error fetching copilot billing seats in '${ent}'`)
      throw error
    }
  }
}

module.exports = { UserManager }
