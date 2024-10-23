const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getTeamsForUser', () => {
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
    const mockData = {
      enterprise: {
        organizations: {
          nodes: [
            {
              login: 'org1',
              id: '1',
              url: 'https://example.com/org1',
              name: 'Org 1',
              description: 'Org 1 description',
              teams: createTeams(6)
            },
            {
              login: 'org2',
              id: '2',
              url: 'https://example.com/org2',
              name: 'Org 2',
              description: 'Org 2 description',
              teams: createTeams(2)
            }
          ],
          totalCount: 2,
          pageInfo: {
            hasNextPage: false,
            endCursor: null
          }
        }
      }
    }

    graphql.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield mockData
      }
    })

    const result = await userManager.getTeamsForUser(user, ent)

    expect(result.orgs).toHaveLength(2)
    expect(hold_until_rate_limit_success).not.toHaveBeenCalled()
  })

  it('should handle errors when fetching teams for user', async () => {
    const errorMessage = 'Error fetching users consuming licenses'
    const username = 'test-user'
    graphql.paginate.iterator.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    const result = await userManager.getTeamsForUser(username, ent)

    expect(core.error).toHaveBeenCalledWith(
      `Error fetching teams and orgs for a user : ${username}`
    )
    expect(result.orgs).toHaveLength(0)
  })

  it('should get all orgs if there are more pages', async () => {
    const user = 'test-user'
    const mockData = {
      enterprise: {
        organizations: {
          nodes: [
            {
              login: 'org1',
              id: '1',
              url: 'https://example.com/org1',
              name: 'Org 1',
              description: 'Org 1 description',
              teams: createTeams(6)
            },
            {
              login: 'org2',
              id: '2',
              url: 'https://example.com/org2',
              name: 'Org 2',
              description: 'Org 2 description',
              teams: createTeams(2)
            }
          ],
          totalCount: 2,
          pageInfo: {
            hasNextPage: true,
            endCursor: 'cursor'
          }
        }
      }
    }
    const mockDataPage2 = {
      enterprise: {
        organizations: {
          nodes: [
            {
              login: 'org3',
              id: '3',
              url: 'https://example.com/org3',
              name: 'Org 3',
              description: 'Org 3 description',
              teams: createTeams(6)
            },
            {
              login: 'org4',
              id: '4',
              url: 'https://example.com/org4',
              name: 'Org 4',
              description: 'Org 4 description',
              teams: createTeams(2)
            }
          ],
          totalCount: 2,
          pageInfo: {
            hasNextPage: false,
            endCursor: null
          }
        }
      }
    }

    graphql.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield mockData
        yield mockDataPage2
      }
    })

    const result = await userManager.getTeamsForUser(user, ent)

    expect(result.orgs).toHaveLength(4)
    // currently there's no rate limit check for this case
    expect(hold_until_rate_limit_success).not.toHaveBeenCalled()
  })

  it('should get all teams if there are more pages', async () => {
    const user = 'test-user'
    const mockData = {
      enterprise: {
        organizations: {
          nodes: [
            {
              login: 'org1',
              id: '1',
              url: 'https://example.com/org1',
              name: 'Org 1',
              description: 'Org 1 description',
              teams: createTeams(100, 121)
            },
            {
              login: 'org2',
              id: '2',
              url: 'https://example.com/org2',
              name: 'Org 2',
              description: 'Org 2 description',
              teams: createTeams(2)
            }
          ],
          totalCount: 2,
          pageInfo: {
            hasNextPage: true,
            endCursor: 'cursor'
          }
        }
      }
    }
    const mockTeams = createTeams(21)
    mockTeams.nodes = mockTeams.edges.map(team => team.node)
    const moreTeams = {
      organization: {
        teams: mockTeams
      }
    }

    graphql.paginate.iterator.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield mockData
      }
    })
    graphql.paginate.iterator.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {
        yield moreTeams
      }
    })

    const result = await userManager.getTeamsForUser(user, ent)

    expect(result.orgs).toHaveLength(2)
    expect(result.orgs[0].teams).toHaveLength(121)
    // currently there's no rate limit check for this case
    expect(hold_until_rate_limit_success).not.toHaveBeenCalled()
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
    edges: teams.map(team => ({ node: team })),
    totalCount,
    pageInfo: {
      hasNextPage: totalCount > 100,
      endCursor: totalCount > 100 ? 'cursor' : null
    }
  }
}
