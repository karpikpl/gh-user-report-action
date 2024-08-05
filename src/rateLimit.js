const core = require('@actions/core')
const github = require('@actions/github')

/**
 * Calls the GitHub API.
 * @param {string} token - The GitHub API token.
 * @param {number} callsNeeded - The number of API calls needed.
 * @returns {Promise<void>}
 */
async function callGitHubAPI(token, callsNeeded) {
  try {
    const octokit = github.getOctokit(token)

    // ignore eslint warning as we need to call the API in a loop
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // make a dummy request to get the rate limit
      const response = await octokit.request('GET /users/octocat')

      const isEnough = await waitIfNotEnoughCalls(response.headers, callsNeeded)

      if (isEnough) {
        break
      }
    }
  } catch (error) {
    console.error(`Error calling GitHub API: ${error}`)
  }
}

/**
 * Waits if the remaining API calls are not enough.
 * Parses the rate limit from the response headers and waits for 60 seconds if the remaining calls are less than needed.
 * @param {Object} headers - The response headers from the GitHub API call.
 * @param {number} callsNeeded - The number of API calls needed.
 * @returns {Promise<boolean>} - Returns a promise that resolves to `true` if there are enough remaining calls, otherwise `false`.
 */
async function waitIfNotEnoughCalls(headers, callsNeeded) {
  // parse the rate limit from the response headers
  const remaining = parseInt(headers['x-ratelimit-remaining'], 10)

  if (remaining < callsNeeded) {
    core.info('Rate limit approaching, waiting for 60 seconds...')
    await new Promise(resolve => setTimeout(resolve, 60000))
    return false
  } else {
    core.info(
      `💥 Rate limit checked. We have ${remaining} remaining, continuing...`
    )
    return true
  }
}

/**
 * This function will call the GitHub API until the rate limit is below the threshold.
 * It will wait for 60 seconds before checking the rate limit again.
 * @param {number} callsNeeded - The number of API calls needed.
 * @param {string} token - The GitHub API token.
 * @param {Object} [initialHeaders] - Optional initial headers for the API call.
 * @returns {Promise<void>}
 */
async function hold_until_rate_limit_success(
  callsNeeded,
  token,
  initialHeaders
) {
  try {
    if (initialHeaders) {
      const isEnough = await waitIfNotEnoughCalls(initialHeaders, callsNeeded)

      if (isEnough) {
        return
      }
    }

    await callGitHubAPI(token, callsNeeded)
  } catch (error) {
    console.error(`Error calling GitHub API: ${error}`)
  }
}

module.exports = { hold_until_rate_limit_success, callGitHubAPI }
