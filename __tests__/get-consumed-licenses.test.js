const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getConsumedLicenses', () => {
  let userManager
  let octokit
  let graphql
  const token = 'test-token'
  const ent = 'test-enterprise'

  beforeEach(async () => {
    octokit = {
      paginate: {
        iterator: jest.fn()
      },
      request: jest.fn()
    }
    graphql = {
      paginate: {
        iterator: jest.fn()
      }
    }

    userManager = new UserManager(token)
    userManager.graphql = graphql
    userManager.octokit = octokit
    core.info = jest.fn()
    core.error = jest.fn()

    // mock rate limit check
    hold_until_rate_limit_success.mockResolvedValue()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should fetch all consumed copilot licenses in an enterprise successfully', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }

    octokit.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          data: {
            users: createRandomUsers(100),
            total_seats_consumed: 251,
            total_seats_purchased: 300
          },
          headers
        }
        yield {
          data: {
            users: createRandomUsers(100),
            total_seats_consumed: 251,
            total_seats_purchased: 300
          },
          headers
        }
        yield {
          data: {
            users: createRandomUsers(51),
            total_seats_consumed: 251,
            total_seats_purchased: 300
          },
          headers
        }
      }
    })

    const result = await userManager.getConsumedLicenses(ent)

    expect(result).toHaveLength(251)
    // check if 12 api calls available (we need 2 pages 100 orgs each + buffer of 10)
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(
      13,
      token,
      headers
    )
  })

  it('should handle errors when fetching consumed copilot licenses in an enterprise', async () => {
    const errorMessage = 'Error fetching users consuming licenses'
    octokit.paginate.iterator.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(userManager.getConsumedLicenses(ent)).rejects.toThrow(
      errorMessage
    )
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching users consuming licenses in '${ent}'`
    )
  })

  it('should perform rate limit check if there are more pages', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }

    const seatsCount = 2683
    let seatsReturned = 0
    octokit.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        while (seatsReturned < seatsCount) {
          const seats =
            seatsCount - seatsReturned > 100 ? 100 : seatsCount - seatsReturned
          seatsReturned += seats

          yield {
            data: {
              users: createRandomUsers(seats),
              total_seats_consumed: seatsCount,
              total_seats_purchased: 3000
            },
            headers
          }
        }
      }
    })

    const result = await userManager.getConsumedLicenses(ent)

    expect(result).toHaveLength(seatsCount)
    expect(core.info).toHaveBeenCalledWith(
      `${seatsCount} total users. Performing rate limit check...`
    )
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(
      37,
      token,
      headers
    )
    expect(hold_until_rate_limit_success).toHaveBeenCalledTimes(1)
  })
})

function createRandomUsers(count) {
  const users = []

  for (let i = 0; i < count; i++) {
    const randomName = `user_${Math.random().toString(36).substring(7)}`

    users.push({
      github_com_login: randomName,
      github_com_name: `User ${i}`,
      enterprise_server_user_ids: [],
      github_com_user: true,
      enterprise_server_user: true,
      visual_studio_subscription_user: false,
      license_type: 'enterprise',
      github_com_profile: `https://github.com/${randomName}`,
      github_com_member_roles: ['org1:Owner', 'org2:Member'],
      github_com_enterprise_roles: ['owner', 'member'],
      github_com_verified_domain_emails: [`${randomName}@github.com`],
      github_com_saml_name_id: randomName,
      github_com_orgs_with_pending_invites: ['org1'],
      github_com_two_factor_auth: true,
      enterprise_server_emails: [`${randomName}@github.com`],
      visual_studio_license_status: '',
      visual_studio_subscription_email: '',
      total_user_accounts: 3
    })
  }

  return users
}
