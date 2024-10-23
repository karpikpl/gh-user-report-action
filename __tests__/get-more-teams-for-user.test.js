const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager', () => {
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

  it('should fetch all teams for the user successfully', async () => {
    const user = 'test-user'
    const org = 'test-org'
    const mockTeams = createTeams(21)
    const moreTeams = {
      organization: {
        teams: mockTeams
      }
    }

    graphql.paginate.iterator.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield moreTeams
      }
    })

    const result = await userManager.getMoreTeamsForUser(user, org, 'cursor')

    expect(result).toHaveLength(21)
    // no rate limit because single call
    expect(hold_until_rate_limit_success).not.toHaveBeenCalled()
  })

  it('should handle errors when fetching teams for user', async () => {
    const errorMessage = 'Error fetching teams'
    const username = 'test-user'
    const org = 'test-org'

    graphql.paginate.iterator.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(
      userManager.getMoreTeamsForUser(username, org, 'cursor')
    ).rejects.toThrow(errorMessage)
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching teams for ${username} in ${org} org:`
    )
  })

  it('should get all teams if there are more pages', async () => {
    const user = 'test-user'
    const org = 'test-org'

    graphql.paginate.iterator.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield {
          organization: {
            teams: createTeams(100, 256)
          }
        }
        yield {
          organization: {
            teams: createTeams(100, 256)
          }
        }
        yield {
          organization: {
            teams: createTeams(56, 256)
          }
        }
      }
    })

    const result = await userManager.getMoreTeamsForUser(user, org, 'cursor')

    expect(result).toHaveLength(256)
    // no rate limit because single call
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(13, token)
  })
})

function createTeams(count, totalCount) {
  const teams = []

  for (let i = 0; i < count; i++) {
    const randomName = `team_${Math.random().toString(36).substring(7)}`

    teams.push({
      login: randomName,
      name: `Team ${i}`,
      description: `Team ${i} description ${randomName}`
    })
  }
  totalCount = totalCount || count
  return {
    nodes: teams,
    totalCount,
    pageInfo: {
      hasNextPage: totalCount > 100,
      endCursor: totalCount > 100 ? 'cursor' : null
    }
  }
}
