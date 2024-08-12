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

    const path = await new ReportBuilder(token).buildReport(ent)

    // Set outputs for other workflow steps to use
    core.setOutput('file', path)
  } catch (error) {
    // Fail the workflow run if an error occurs
    core.setFailed(error.message)
  }
}

module.exports = {
  run
}
