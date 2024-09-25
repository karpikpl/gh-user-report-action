const core = require('@actions/core')
const { ReportBuilder } = require('./reportBuilder')
/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run() {
  try {
    const ent = core.getInput('github-enterprise', { required: true })
    const token = core.getInput('github-pat', { required: true })
    const getLastActivityDate = core.getBooleanInput('get-last-activity-date', {
      required: false
    })

    const path = await new ReportBuilder(token).buildReport(
      ent,
      getLastActivityDate
    )

    // Set outputs for other workflow steps to use
    core.setOutput('file', path)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (
      error.message ===
      "Cannot read properties of null (reading 'hasOwnProperty')"
    ) {
      core.warning(
        '🔥 Most likely authentication to GitHub failed or GitHub returned NULL. Please check your enterprise name and token and verify SSO was configured for it.'
      )
    }
    core.setFailed(error.message)
  }
}

module.exports = {
  run
}
