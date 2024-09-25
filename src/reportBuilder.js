const { UserManager } = require('./userManager')
const { toCSV } = require('./csvHelper')
const core = require('@actions/core')

class ReportBuilder {
  constructor(token) {
    this.manager = new UserManager(token)
  }

  /**
   * Build a report for the given enterprise.
   * @param {string} ent The enterprise name.
   * @param {boolean} getLastActivityDate Whether to get the last activity date.
   * @returns {Promise<string>} The path to the CSV file.
   */
  async buildReport(ent, getLastActivityDate) {
    // first get all orgs in the enterprise - this should be 1 API call
    core.info(`Getting orgs in '${ent}'`)
    const orgs = await this.manager.getAllOrganizationsInEnterprise(ent)
    toCSV(orgs, `orgs_in_${ent}`)

    core.info(
      `Found ${orgs.length} orgs in '${ent}': ${orgs.map(o => `'${o.login}'`).join(', ')}`
    )

    // get all the users in the enterprise - number_of_users / 100 API calls
    core.info(`Getting users in '${ent}'`)
    const users = await this.manager.getConsumedLicenses(ent)
    core.info(`Found ${users.length} users in '${ent}'`)

    core.info(`Getting last 50 pages of audit log for '${ent}'`)
    const auditLogDict = await this.manager.getLast50PagesOfAuditLog(ent, 1)

    // this is were it gets tricky - for each user we need to get the orgs and teams they are in
    // this is where we need to be careful with the rate limit
    const report = []
    for (const user of users) {
      const percentComplete = Math.floor((report.length / users.length) * 100)
      core.info(
        `${percentComplete}%. Building report for ${user.github_com_login}.`
      )

      const userReport = await this.manager.getOrgsAndTeamsForUser(
        user.github_com_login,
        ent,
        orgName => orgs.find(o => o.login === orgName)
      )

      if (getLastActivityDate) {
        // get the last activity for the user
        if (auditLogDict[user.github_com_login]) {
          user.lastActivityAudit = auditLogDict[user.github_com_login]
        } else {
          user.lastActivityAudit = await this.manager.getLastActivityForUser(
            user.github_com_login,
            ent
          )
        }
      } else {
        core.warning('⚠️Skipping GitHub audit call to get last activity date.')
      }

      const newEntry = {
        github_com_login: user.github_com_login,
        github_com_name: user.github_com_name,
        visual_studio_subscription_user: user.visual_studio_subscription_user,
        license_type: user.license_type,
        github_com_profile: user.github_com_profile,
        'Account Creation Date': user.created_at,
        'User Team Membership': userReport
          .map(o =>
            o.teams && o.teams.length > 0
              ? o.teams.map(t => t.name).join(',')
              : 'No Teams'
          )
          .join(','),
        'User Organization Membership': userReport
          .map(o => o.org.login)
          .join(','),
        'Last Activity Profile': 'n/a',
        'Last Activity Audit Log': user.lastActivityAudit,
        'Enterprise Roles': user.github_com_enterprise_roles.join(', '),
        'Member Roles': user.github_com_member_roles.join(', '),
        'Verified Domain E-Mails':
          user.github_com_verified_domain_emails.join(','),
        github_com_saml_name_id: user.github_com_saml_name_id,
        'Pending Invites': user.github_com_orgs_with_pending_invites.join(','),
        github_com_two_factor_auth: user.github_com_two_factor_auth,
        'VS License Status': user.visual_studio_license_status,
        'VS Subscription E-mail': user.visual_studio_subscription_email
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
    const csvPath = toCSV(report, `users_in_${ent}`)

    return csvPath
  }
}

module.exports = { ReportBuilder }
