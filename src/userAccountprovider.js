const { StorageTableClient } = require('./storageTableclient')
const { UserManager } = require('./userManager')
const core = require('@actions/core')

/* table with users public data */
const tableName = 'userspublicdata'

/**
 * A provider for getting the last activity date for a user.
 * @class
 * @classdesc A provider for getting the last activity date for a user.
 * @property {UserManager} manager The user manager.
 * @property {StorageTableClient} tableClient The table storage client.
 * @property {Array<{partitionKey:string, rowKey:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string, lastUpdated: Date}>} users The users in the table.
 * @property {integer} rateLimitRemaining The remaining rate limit for the GitHub Enterprise API. (default 5000)
 */
class UserAccountProvider {
  /**
   * Creates a new instance of the UserAccountProvider.
   * @param {UserManager} userManager The GitHub token.
   * @param {string} tableStorageConnectionString Connection String to Azure Table Storage.
   * @returns {UserAccountProvider} The new instance.
   * @constructor
   */
  constructor(userManager, tableStorageConnectionString) {
    this.manager = userManager
    this.rateLimitRemaining = 1000 // assume we have 1000 calls left

    if (tableStorageConnectionString) {
      core.info(`Using Azure Table Storage for User Cache.`)
      this.tableClient = new StorageTableClient(
        tableStorageConnectionString,
        tableName
      )
    }
  }

  /**
   * Initialize the cache with all users.
   * @param {Array<{
   * github_com_login : string,
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
   * It checks which 2000 users have the oldest `lastUpdated` date and refreshes their cache.
   * @returns {Promise<void>} Resolves when the cache is refreshed.
   * @async
   * @throws {Error} Throws an error when the rate limit is low.
   */
  async refreshUserData() {
    if (this.tableClient) {
      // get top 2000 users with oldest `lastUpdated` date

      /**
       * @type {Array<{partitionKey:string, rowKey:string, created_at: Date, updated_at: Date, company: string, name: string, lastUpdated: Date}>}
       */
      const usersToCheck = this.users
        .sort((a, b) => {
          const aDate = a.lastUpdated ? new Date(a.lastUpdated) : new Date(0) // Treat null as the oldest date
          const bDate = b.lastUpdated ? new Date(b.lastUpdated) : new Date(0) // Treat null as the oldest date
          return aDate - bDate
        })
        .slice(0, 2000)

      let index = 0

      for (const user of usersToCheck) {
        try {
          const response = await this.manager.getUser(user.rowKey)

          const updated = await this.tableClient.upsertUserData(
            user.rowKey,
            response.userData
          )
          // update the cache
          user.lastUpdated = updated.lastUpdated
          user.created_at = updated.created_at
          user.updated_at = updated.updated_at
          user.company = updated.company
          user.name = updated.name

          const percentComplete = Math.floor(
            (index / usersToCheck.length) * 100
          )
          index++
          core.info(
            `${percentComplete}%. Refreshed User Cache for ${user.rowKey}.`
          )

          if (response.rateLimitRemaining < 5) {
            core.warning(`Rate limit is low. Stopping User Cache refresh.`)
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
   * Get the user data, either by API call or from the cache when table storage is available.
   * @param {string} github_com_login The GitHub login for the user.
   * @returns {Promise<{login:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string, lastChecked: Date}>} User data
   */
  async getUserData(github_com_login) {
    if (!this.tableClient) {
      // when there's no table storage, just call the API
      try {
        if (this.rateLimitRemaining < 5) {
          core.warning(`Rate limit is low. Cancelling calls to the API.`)
          return {
            login: github_com_login,
            lastChecked: null,
            id: null,
            type: null,
            created_at: null,
            updated_at: null,
            company: null,
            name: null
          }
        }

        const userDataResponse = await this.manager.getUser(
          github_com_login,
          false // do not sleep on rate limit hit
        )
        // update the rate limit remaining
        this.rateLimitRemaining = userDataResponse.rateLimitRemaining

        return userDataResponse.userData
      } catch (error) {
        core.error(
          `Error getting last activity for ${github_com_login} for User API: ${error}`
        )
        return {
          login: github_com_login,
          lastChecked: null,
          id: null,
          type: null,
          created_at: null,
          updated_at: null,
          company: null,
          name: null
        }
      }
    }

    // if table storage is available, check the cache first
    const user = this.users.find(u => u.rowKey === github_com_login)

    if (!user) {
      // if the user is not in the cache log a warning
      core.warning(`User ${github_com_login} not found in the User Cache.`)
      return {
        login: github_com_login,
        lastChecked: null,
        id: null,
        type: null,
        created_at: null,
        updated_at: null,
        company: null,
        name: null,
        rateLimitRemaining: this.rateLimitRemaining
      }
    }

    // if the user data is empty or wasn't updated in 3 days, refresh it
    let needToUpdate = false

    if (user.lastUpdated) {
      const lastUpdatedDate = new Date(user.lastUpdated)
      const currentDate = new Date()
      const diffTime = Math.abs(currentDate - lastUpdatedDate)
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      if (diffDays > 3) {
        core.info(
          `User ${github_com_login} was not updated in ${diffDays} days. Refreshing data.`
        )
        needToUpdate = true
      }
    } else {
      // no lastUpdated date means the user needs to be updated
      needToUpdate = true
    }

    if (!needToUpdate) {
      // user is fresh
      core.info(`User ${github_com_login} is fresh. No need to update.`)
      return {
        login: github_com_login,
        lastChecked: user.lastChecked,
        id: user.id,
        type: user.type,
        created_at: user.created_at,
        updated_at: user.updated_at,
        company: user.company,
        name: user.name
      }
    }

    if (this.rateLimitRemaining < 5) {
      core.warning(`Rate limit is low. Cancelling calls to the API.`)
      return {
        login: github_com_login,
        lastChecked: user.lastChecked,
        id: user.id,
        type: user.type,
        created_at: user.created_at,
        updated_at: user.updated_at,
        company: user.company,
        name: user.name
      }
    }
    const userResponse = await this.manager.getUser(github_com_login, false)
    // update the rate limit remaining
    this.rateLimitRemaining = userResponse.rateLimitRemaining

    // update table storage
    const updated = await this.tableClient.upsertUserData(
      github_com_login,
      userResponse.userData
    )

    // update the cache
    user.lastUpdated = updated.lastUpdated
    user.created_at = updated.created_at
    user.updated_at = updated.updated_at
    user.company = updated.company
    user.name = updated.name
    user.id = updated.id
    user.type = updated.type

    return userResponse.userData
  }
}

module.exports = {
  UserAccountProvider
}
