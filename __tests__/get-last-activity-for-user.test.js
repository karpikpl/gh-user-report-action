const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getLastActivityForUser', () => {
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

  it('should fetch last activity for user successfully', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }
    const username = 'test-joe'
    const date = new Date()

    octokit.request.mockReturnValue({
      data: [
        {
          '@timestamp': Math.floor(date.getTime())
        }
      ],
      headers
    })

    const result = await userManager.getLastActivityForUser(username, ent)

    expect(result.lastActivityDate).toEqual(date)
    expect(result.rateLimitRemaining).toEqual(100)
  })

  it('should handle errors when fetching last activity', async () => {
    const errorMessage = 'Error fetching users consuming licenses'
    const username = 'test-joe'
    octokit.request.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(
      userManager.getLastActivityForUser(username, ent)
    ).rejects.toThrow(errorMessage)
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching last activity for ${username} in '${ent}' enterprise.`
    )
  })

  it('should fetch last activity for user successfully when theres no activity', async () => {
    const headers = {
      'x-ratelimit-remaining': 87
    }
    const username = 'test-joe'
    const date = new Date()

    octokit.request.mockReturnValue({
      data: [],
      headers
    })

    const result = await userManager.getLastActivityForUser(username, ent)

    expect(result.lastActivityDate).toEqual(null)
    expect(result.rateLimitRemaining).toEqual(87)
  })
})
