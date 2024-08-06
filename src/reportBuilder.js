const { UserManager } = require('./userManager')
const { toCSV } = require('./csvHelper')
const core = require('@actions/core')

class ReportBuilder {
  constructor(token) {
    this.manager = new UserManager(token)
  }

  async buildReport(ent) {
    // first get all orgs in the enterprise - this should be 1 API call
    const orgs = await this.manager.getAllOrganizationsInEnterprise(ent)
    await this.saveReport(orgs, `orgs_in_${ent}`)

    core.info(`Found ${orgs.length} orgs in ${ent}`)

    // get all the users in the enterprise - number_of_users / 100 API calls
    const users = await this.manager.getConsumedLicenses(ent)

    core.info(`Found ${users.length} users in ${ent}`)

    // this is were it gets tricky - for each user we need to get the orgs and teams they are in
    // this is where we need to be careful with the rate limit
    const report = []
    for (const user of users) {
      const userReport = await this.manager.getOrgsAndTeamsForUser(
        user.github_com_login,
        ent
      )
      report.push({
        github_com_login: user.github_com_login,
        github_com_name: user.github_com_name,
        visual_studio_subscription_user: user.visual_studio_subscription_user,
        license_type: user.license_type,
        github_com_profile: user.github_com_profile,
        github_com_enterprise_roles: user.github_com_enterprise_roles,
        github_com_member_roles: user.github_com_member_roles,
        github_com_verified_domain_emails:
          user.github_com_verified_domain_emails,
        github_com_saml_name_id: user.github_com_saml_name_id,
        github_com_orgs_with_pending_invites:
          user.github_com_orgs_with_pending_invites,
        github_com_two_factor_auth: user.github_com_two_factor_auth,
        visual_studio_license_status: user.visual_studio_license_status,
        visual_studio_subscription_email: user.visual_studio_subscription_email,
        teams: userReport
          .map(o =>
            o.teams && o.teams.length > 0
              ? o.teams.map(t => t.name).join(',')
              : 'No Teams'
          )
          .join(','),
        orgs: userReport.map(o => o.login).join(',')
      })
    }

    core.info(`Built report for ${report.length} users`)
    await this.saveReport(report, `users_in_${ent}`)
  }

  async saveReport(report, type) {
    toCSV(report, type)
  }
}

module.exports = { ReportBuilder }
