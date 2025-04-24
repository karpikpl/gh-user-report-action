const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getUser', () => {
  let userManager
  let octokit
  let graphql
  const token = 'test-token'

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

  it('should fetch user data for user successfully', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }
    const username = 'test-joe'
    const date = new Date()

    octokit.request.mockReturnValue({
      data: {
        login: username,
        id: 123456,
        type: 'User',
        user_view_type: 'private',
        site_admin: false,
        name: 'Joe Test',
        company: 'Microsoft',
        location: 'Charlotte',
        email: null,
        hireable: null,
        bio: 'Cloud Solution Architect @microsoft',
        created_at: '2013-02-12T08:31:17Z',
        updated_at: '2025-04-14T13:03:47Z'
      },
      headers
    })

    const result = await userManager.getUser(username)

    expect(result.userData.login).toEqual(username)
    expect(result.rateLimitRemaining).toEqual(100)
  })

  it('should handle errors when fetching user data', async () => {
    const errorMessage = 'Error fetching user data'
    const username = 'test-joe'
    octokit.request.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(userManager.getUser(username)).rejects.toThrow(errorMessage)
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching user data for ${username}`
    )
  })

  it('should fetch user data for user successfully when API returns empty', async () => {
    const headers = {
      'x-ratelimit-remaining': 87
    }
    const username = 'test-joe'
    const date = new Date()

    octokit.request.mockReturnValue({
      data: null,
      headers
    })

    const result = await userManager.getUser(username)

    expect(result.userData).toEqual(null)
    expect(result.rateLimitRemaining).toEqual(87)
  })
})
