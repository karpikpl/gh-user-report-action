const core = require('@actions/core')
// const github = require('@actions/github')
const { hold_until_rate_limit_success } = require('./rateLimit')

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
        query($ent: String!) {
        enterprise(slug: $ent) {
            organizations(first: 100) {
            nodes {
                name
                id
                url
            }
            pageInfo {
                hasNextPage
                endCursor
                }
            }
        }
        }
            `

    try {
      const result = await this.graphql.paginate(query, { ent })

      //const result = await this.graphqlWithAuth.paginate(query, { ent })
      return result.enterprise.organizations.nodes
    } catch (error) {
      console.error('Error fetching organizations:', error)
      throw error
    }
  }

  async getConsumedLicenses(ent) {
    await this.init()

    try {
      const page_size = 5
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
        if (!page_check_done) {
          core.info(
            `${response.data.total_seats_consumed} total users. Performing rate limit check...`
          )

          const totalCalls = Math.ceil(
            response.data.total_seats_consumed / page_size
          )
          await hold_until_rate_limit_success(totalCalls + 10, this.token)
          page_check_done = true
        }
      }

      return users
    } catch (error) {
      console.error('Error fetching users consuming licenses:', error)
      throw error
    }
  }
}

module.exports = { UserManager }
