const { StorageTableClient } = require('./storageTableclient')
const { UserManager } = require('./userManager')
const core = require('@actions/core')

/**
 * A provider for getting the last activity date for a user.
 * @class
 * @classdesc A provider for getting the last activity date for a user.
 * @property {UserManager} manager The user manager.
 * @property {StorageTableClient} tableClient The table storage client.
 * @property {string} ent The enterprise name.
 * @property {Array<{partitionKey:string, rowKey:string, lastActivityDate: Date, lastUpdated: Date}>} users The users in the table.
 * @property {integer} rateLimitRemaining The remaining rate limit for the GitHub Enterprise Audit Log API. (default 1750)
 */
class LastActivityProvider {
  /**
   * Creates a new instance of the LastActivityProvider.
   * @param {UserManager} userManager The GitHub token.
   * @param {string} tableStorageConnectionString Connection String to Azure Table Storage.
   * @param {string} ent The enterprise name
   * @returns {LastActivityProvider} The new instance.
   * @constructor
   */
  constructor(userManager, tableStorageConnectionString, ent) {
    this.manager = userManager
    this.ent = ent
    this.rateLimitRemaining = 1750 // assume we have 1750 calls left

    if (tableStorageConnectionString) {
      core.info(`Using Azure Table Storage for Audit Cache.`)
      this.tableClient = new StorageTableClient(tableStorageConnectionString)
    }
  }

  /**
   * Initialize the cache with all users.
   * @param {Array<{
   * github_com_login : string,
   * github_com_name: string?,
   * enterprise_server_user_ids : Array<string>,
   * github_com_user : boolean,
   * enterprise_server_user: boolean?,
   * visual_studio_subscription_user : boolean,
   * license_type : string,
   * github_com_profile: string?,
   * github_com_member_roles : Array<string>,
   * github_com_enterprise_roles : Array<string>,
   * github_com_verified_domain_emails : Array<string>,
   * github_com_saml_name_id: string?,
   * github_com_orgs_with_pending_invites : Array<string>,
   * github_com_two_factor_auth: boolean?,
   * enterprise_server_emails : Array<string>,
   * visual_studio_license_status: string?,
   * visual_studio_subscription_email: string?,
   * total_user_accounts : integer
   * }>} allUsers all users in the enterprise.
   * @returns {Promise<void>} Resolves when the cache is initialized.
   */
  async initialize(allUsers) {
    if (this.tableClient) {
      await this.tableClient.createTable()
      this.users = await this.tableClient.getAll()

      // find which users are missing in the cache and add them with empty last activity date
      const missingUsers = allUsers
        .filter(
          user => !this.users.some(u => u.rowKey === user.github_com_login)
        )
        .map(user => user.github_com_login)

      if (missingUsers.length > 0) {
        await this.tableClient.bulkInsert(missingUsers)
      }

      this.users = await this.tableClient.getAll()
    } else {
      core.warning(`⚠️ No Azure Table Storage connection string provided.`)
    }
  }

  /**
   * Refresh the cache for the users.
   * It checks which 1750 users have the oldest `lastUpdated` date and refreshes their cache.
   * @returns {Promise<void>} Resolves when the cache is refreshed.
   * @async
   * @throws {Error} Throws an error when the rate limit is low.
   */
  async refreshUserData() {
    if (this.tableClient) {
      // get top 1750 users with oldest `lastUpdated` date
      /**
       * @type {Array<{partitionKey:string, rowKey:string, lastActivityDate: Date, lastUpdated: Date}>}
       */
      const usersToCheck = this.users
        .sort((a, b) => {
          const aDate = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0) // Treat null as the oldest date
          const bDate = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0) // Treat null as the oldest date
          return aDate - bDate
        })
        .slice(0, 1750)

      let index = 0

      for (const user of usersToCheck) {
        try {
          const lastActivityInfo = await this.manager.getLastActivityForUser(
            user.rowKey,
            this.ent
          )

          const updated = await this.tableClient.upsertUser(
            user.rowKey,
            lastActivityInfo.lastActivityDate
          )
          // update the cache
          user.lastUpdated = updated.lastUpdated
          user.lastActivityDate = updated.lastActivityDate

          const percentComplete = Math.floor(
            (index / usersToCheck.length) * 100
          )
          index++
          core.info(
            `${percentComplete}%. Refreshed Audit Cache for ${user.rowKey}.`
          )

          if (lastActivityInfo.rateLimitRemaining < 5) {
            core.warning(`Rate limit is low. Stopping Audit Cache refresh.`)
            break
          }
        } catch (error) {
          core.warning(
            `Error getting last activity for ${user.rowKey}: ${error}`
          )
        }
      }
    }
  }

  /**
   * Get the last activity date for a user either by API call or from the cache when table storage is available.
   * @param {string} github_com_login The GitHub login for the user.
   * @returns {Promise<{lastActivityDate: Date?, lastChecked: Date?, rateLimitRemaining: integer}>} The last activity date.
   */
  async getLastActivityDateForUser(github_com_login) {
    if (!this.tableClient) {
      // when there's no table storage, just call the API
      try {
        if (this.rateLimitRemaining < 5) {
          core.warning(`Rate limit is low. Cancelling calls to Audit Log API.`)
          return {
            lastActivityDate: null,
            lastChecked: null,
            rateLimitRemaining: this.rateLimitRemaining
          }
        }

        const lastDateFromAuditCall = await this.manager.getLastActivityForUser(
          github_com_login,
          this.ent,
          false // do not sleep on rate limit hit
        )
        // update the rate limit remaining
        this.rateLimitRemaining = lastDateFromAuditCall.rateLimitRemaining

        return {
          lastActivityDate: lastDateFromAuditCall.lastActivityDate,
          lastChecked: new Date(),
          rateLimitRemaining: lastDateFromAuditCall.rateLimitRemaining
        }
      } catch (error) {
        core.error(
          `Error getting last activity for ${github_com_login} for Audit API: ${error}`
        )
        return {
          lastActivityDate: null,
          lastChecked: null,
          rateLimitRemaining: this.rateLimitRemaining
        }
      }
    }

    // if table storage is available, check the cache only
    const user = this.users.find(u => u.rowKey === github_com_login)

    if (user) {
      return {
        lastActivityDate: user.lastActivityDate,
        lastChecked: user.lastUpdated
      }
    }

    // if the user is not in the cache log a warning
    core.warning(`User ${github_com_login} not found in the Audit Cache.`)
    return { lastActivityDate: null, lastChecked: null }
  }
}

module.exports = {
  LastActivityProvider
}
