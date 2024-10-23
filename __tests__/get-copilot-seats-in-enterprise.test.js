const { UserManager } = require('../src/userManager')
const { hold_until_rate_limit_success } = require('../src/rateLimit')
const core = require('@actions/core')

jest.mock('../src/rateLimit')

describe('UserManager - getCopilotSeats', () => {
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

  it('should fetch all copilot seats in an enterprise successfully', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }
    const seats = createSeats(75)
    octokit.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          data: seats,
          headers
        }
      }
    })

    const result = await userManager.getCopilotSeats(ent)

    expect(result.size).toBe(75)
    expect(result['user_5']).toBe(seats[5])
    expect(hold_until_rate_limit_success).not.toHaveBeenCalled()
  })

  it('should handle errors when fetching organizations', async () => {
    const errorMessage = 'Error fetching copilot seats'
    octokit.paginate.iterator.mockImplementation(() => {
      throw new Error(errorMessage)
    })

    await expect(userManager.getCopilotSeats(ent)).rejects.toThrow(errorMessage)
    expect(core.error).toHaveBeenCalledWith(
      `Error fetching copilot billing seats in '${ent}'`
    )
  })

  it('should perform rate limit check if there are more pages', async () => {
    const headers = {
      'x-ratelimit-remaining': 100
    }
    octokit.paginate.iterator.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          data: createSeats(100, 373, '1_'),
          headers
        }
        yield {
          data: createSeats(100, 373, '2_'),
          headers
        }
        yield {
          data: createSeats(100, 373, '3_'),
          headers
        }
        yield {
          data: createSeats(73, 373, '4_'),
          headers
        }
      }
    })

    const result = await userManager.getCopilotSeats(ent)

    expect(result.size).toBe(373)
    expect(hold_until_rate_limit_success).toHaveBeenCalledWith(
      14,
      token,
      headers
    )
    expect(hold_until_rate_limit_success).toHaveBeenCalledTimes(1)
  })
})

function createSeats(count, totalSeats, batch = '') {
  const seats = []

  for (let i = 0; i < count; i++) {
    const randomName = `org_${Math.random().toString(36).substring(7)}`
    const daysInPast = Math.floor(Math.random() * 100)

    seats.push({
      created_at: new Date(
        Date.now() - daysInPast * 24 * 60 * 60 * 1000
      ).toISOString(),
      updated_at: new Date(
        Date.now() - daysInPast * 24 * 60 * 60 * 1000
      ).toISOString(),
      pending_cancellation_date: null,
      last_activity_at: new Date().toISOString(),
      last_activity_editor: 'vscode',
      assignee: {
        login: `${batch}user_${i}`
      },
      assigning_team: daysInPast % 2 === 0 ? null : { slug: `team_${i}` },
      organization: {
        login: randomName
      }
    })
  }

  totalSeats = totalSeats || count

  return {
    seats,
    total_seats: totalSeats
  }
}
