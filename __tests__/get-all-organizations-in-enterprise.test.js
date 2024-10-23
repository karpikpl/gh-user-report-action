const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getAllOrganizationsInEnterprise', () => {
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

  it('should fetch all organizations in an enterprise successfully', async () => {
    const mockOrgsPage1 = [
      { login: 'org1', id: '1', url: 'https://example.com/org1' },
      { login: 'org2', id: '2', url: 'https://example.com/org2' }
    ]
    const mockOrgsPage2 = [
      { login: 'org3', id: '3', url: 'https://example.com/org3' },
      { login: 'org4', id: '4', url: 'https://example.com/org4' }
    ]

    graphql.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgsPage1,
              totalCount: 200,
              pageInfo: {
                hasNextPage: true,
                endCursor: 'cursor1'
              }
            }
          }
        }
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgsPage2,
              totalCount: 200,
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            }
          }
        }
      }
    })

    const result = await userManager.getAllOrganizationsInEnterprise(ent)

    expect(result).toEqual(mockOrgsPage1.concat(mockOrgsPage2))
    // check if 12 api calls available (we need 2 pages 100 orgs each + buffer of 10)
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(12, token)
  })

  it('should handle errors when fetching organizations', async () => {
    const errorMessage = 'Error fetching organizations'
    graphql.paginate.iterator.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(
      userManager.getAllOrganizationsInEnterprise(ent)
    ).rejects.toThrow(errorMessage)
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching organizations for '${ent}'`
    )
  })

  it('should perform rate limit check if there are more pages', async () => {
    const mockOrgs = [
      { login: 'org1', id: '1', url: 'https://example.com/org1' }
    ]

    graphql.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgs,
              totalCount: 301,
              pageInfo: {
                hasNextPage: true,
                endCursor: mockOrgs
              }
            }
          }
        }
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgs,
              totalCount: 301,
              pageInfo: {
                hasNextPage: true,
                endCursor: 'cursor2'
              }
            }
          }
        }
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgs,
              totalCount: 301,
              pageInfo: {
                hasNextPage: true,
                endCursor: 'cursor3'
              }
            }
          }
        }
        yield {
          enterprise: {
            organizations: {
              nodes: mockOrgs,
              totalCount: 301,
              pageInfo: {
                hasNextPage: false,
                endCursor: null
              }
            }
          }
        }
      }
    })

    const result = await userManager.getAllOrganizationsInEnterprise(ent)

    expect(result).toEqual([...mockOrgs, ...mockOrgs, ...mockOrgs, ...mockOrgs])
    expect(core.info).toHaveBeenCalledWith(
      '301 total orgs. Performing rate limit check...'
    )
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(14, token)
    expect(hold_until_rate_limit_success).toHaveBeenCalledTimes(1)
  })
})
