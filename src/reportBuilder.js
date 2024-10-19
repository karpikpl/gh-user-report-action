const { UserManager } = require('./userManager')
const { toCSV } = require('./csvHelper')
const { LastActivityProvider } = require('./lastActivityprovider')
const core = require('@actions/core')

class ReportBuilder {
  /**
   * Creates a new instance of the ReportBuilder.
   * @param {string} token The GitHub token.
   * @param {string} tableStorageConnectionString Connection String to Azure Table Storage.
   * @param {string} ent The enterprise name
   * @returns {ReportBuilder} The new instance.
   * @constructor
   * @property {UserManager} manager The user manager.
   * @property {LastActivityProvider} lastActivityProvider The last activity provider.
   * @property {string} ent The enterprise name.
   */
  constructor(token, tableStorageConnectionString, ent) {
    // Validate input parameters
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error('Invalid GitHub token. It must be a non-empty string.')
    }
    if (typeof ent !== 'string' || ent.trim() === '') {
      throw new Error('Invalid enterprise name. It must be a non-empty string.')
    }

    this.manager = new UserManager(token)
    this.ent = ent
    this.lastActivityProvider = new LastActivityProvider(
      this.manager,
      tableStorageConnectionString,
      ent
    )
  }

  /**
   * Build a report for the given enterprise.
   * @param {string} storageAccount The Azure Storage account name.
   * @param {string} storageSas The Azure Storage SAS token.
   * @returns {Promise<string>} The path to the CSV file.
   */
  async buildReport() {
    // first get all orgs in the enterprise - this should be 1 API call
    core.info(`Getting orgs in '${this.ent}'`)
    const orgs = await this.manager.getAllOrganizationsInEnterprise(this.ent)
    toCSV(orgs, `orgs_in_${this.ent}`)

    core.info(
      `Found ${orgs.length} orgs in '${this.ent}': ${orgs.map(o => `'${o.login}'`).join(', ')}`
    )

    // get all the users in the enterprise - number_of_users / 100 API calls
    core.info(`Getting users in '${this.ent}'`)
    const users = await this.manager.getConsumedLicenses(this.ent)
    core.info(`Found ${users.length} users in '${this.ent}'`)

    // initialize the last activity provider
    await this.lastActivityProvider.initialize(users)
    await this.lastActivityProvider.refreshUserData()

    core.info(`Getting copilot seats 💺💺💺 in '${this.ent}'`)
    const copilotSeats = await this.manager.getCopilotSeats(this.ent)
    core.info(
      `Found ${copilotSeats.size} copilot seats 💺💺💺 in '${this.ent}'`
    )

    // this is were it gets tricky - for each user we need to get the orgs and teams they are in
    // this is where we need to be careful with the rate limit
    const report = []
    for (const user of users) {
      const percentComplete = Math.floor((report.length / users.length) * 100)
      core.info(
        `${percentComplete}%. Building report for ${user.github_com_login}.`
      )

      const userTeamsReport = await this.manager.getTeamsForUser(
        user.github_com_login,
        this.ent
      )

      const lastActivityAudit =
        await this.lastActivityProvider.getLastActivityDateForUser(
          user.github_com_login
        )
      user.lastActivityAudit = lastActivityAudit.lastActivityDate
      user.lastActivityAuditChecked = lastActivityAudit.lastChecked

      const newEntry = {
        github_com_login: user.github_com_login,
        github_com_name: user.github_com_name,
        visual_studio_subscription_user: user.visual_studio_subscription_user,
        license_type: user.license_type,
        github_com_profile: user.github_com_profile,
        'Account Creation Date': userTeamsReport.created_at,
        'User Team Membership': userTeamsReport.orgs
          .map(o => o.teams)
          .filter(t => t)
          .flat()
          .map(t => t.name)
          .join(','),
        'User Organization Membership': user.github_com_member_roles
          .map(r => r.split(':')[0])
          .join(','),
        'User Organization Ownership': user.github_com_member_roles
          .filter(r => r.endsWith(':Owner'))
          .map(r => r.split(':')[0])
          .join(','),
        'Last Activity Profile': 'n/a',
        'Last Activity Audit Log': user.lastActivityAudit,
        'Last Activity Audit Log Checked': user.lastActivityAuditChecked,
        'Enterprise Roles': user.github_com_enterprise_roles.join(', '),
        'Member Roles': user.github_com_member_roles.join(', '),
        'Verified Domain E-Mails':
          user.github_com_verified_domain_emails.join(','),
        github_com_saml_name_id: user.github_com_saml_name_id,
        'Pending Invites': user.github_com_orgs_with_pending_invites.join(','),
        github_com_two_factor_auth: user.github_com_two_factor_auth,
        'VS License Status': user.visual_studio_license_status,
        'VS Subscription E-mail': user.visual_studio_subscription_email,
        'Copilot Created At':
          copilotSeats.get(user.github_com_login)?.created_at ?? '',
        'Copilot Updated At':
          copilotSeats.get(user.github_com_login)?.updated_at ?? '',
        'Copilot Last Activity At':
          copilotSeats.get(user.github_com_login)?.last_activity_at ?? '',
        'Copilot Last Activity Editor':
          copilotSeats.get(user.github_com_login)?.last_activity_editor ?? '',
        'Copilot Assigning Team':
          copilotSeats.get(user.github_com_login)?.assigning_team?.name ?? '',
        'Copilot Assigning Org':
          copilotSeats.get(user.github_com_login)?.organization?.login ?? '',
        'Copilot Pending Cancellation Date':
          copilotSeats.get(user.github_com_login)?.pending_cancellation_date ??
          ''
      }

      // for all the properties added to the report, remove newlines
      const objectKeys = Object.keys(newEntry)

      for (const key of objectKeys) {
        if (newEntry[key] && typeof newEntry[key] === 'string') {
          newEntry[key] = newEntry[key]
            .replace(/[\r\n]+/gm, '')
            .replace('+rok', '')
        }
      }

      report.push(newEntry)
    }

    core.info(`Built report for ${report.length} users`)
    const csvPath = toCSV(report, `users_in_${this.ent}`)

    return csvPath
  }
}

module.exports = { ReportBuilder }
