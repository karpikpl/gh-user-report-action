const { TableClient, TableTransaction } = require('@azure/data-tables')
const core = require('@actions/core')

const tableName = 'usersaudit'
const partitionKey = 'audit'

/**
 * A client for interacting with Azure Table Storage.
 * @class
 * @classdesc A client for interacting with Azure Table Storage.
 */
class StorageTableClient {
  /**
   * Creates a new instance of the StorageTableClient.
   * @param {string} tableStorageConnectionString Connection String to Azure Table Storage.
   * @returns {StorageTableClient} The new instance.
   * @constructor
   */
  constructor(tableStorageConnectionString, table = tableName) {
    this.tableClient = TableClient.fromConnectionString(
      tableStorageConnectionString,
      table
    )
  }

  /**
   * Create the table if it does not exist
   * @returns {Promise<void>} Resolves when the table is created
   */
  async createTable() {
    await this.tableClient.createTable(tableName, {
      onResponse: response => {
        if (response.status === 409) {
          core.warning(`Table ${tableName} already exists`)
        }
      }
    })
  }

  /**
   * Get all entities in the table
   * @returns {Promise<Array<{partitionKey:string, rowKey:string, lastUpdated: Date, any}>} The entities in the table
   */
  async getAll() {
    const entitiesIterator = this.tableClient.listEntities()

    /**
     * @type {Array<{partitionKey:string, rowKey:string, lastUpdated: Date, any}>}
     * */
    const entities = []

    for await (const entity of entitiesIterator) {
      entities.push(entity)
    }
    return entities
  }

  /**
   * Upsert a user entity
   * @param {string} login The login of the user
   * @param {string} lastActivityDate The last activity date
   * @returns {Promise<{partitionKey:string, rowKey:string, lastActivityDate: Date, lastUpdated: Date}>} The entity that was upserted
   */
  async upsertUser(login, lastActivityDate) {
    const entity = {
      partitionKey,
      rowKey: login,
      lastActivityDate,
      lastUpdated: new Date().toISOString()
    }
    await this.tableClient.upsertEntity(entity)

    return entity
  }

  /**
   * Upsert a user entity
   * @param {string} login The login of the user
   * @param {{login:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string}} user User object
   * @returns {Promise<{partitionKey:string, rowKey:string, login:string, id:number, type:string, created_at: Date, updated_at: Date, company: string, name: string, lastUpdated: Date}>} The entity that was upserted
   */
  async upsertUserData(login, user) {
    const entity = {
      partitionKey,
      rowKey: login,
      id: user.id,
      login: user.login,
      type: user.type,
      created_at: user.created_at,
      updated_at: user.updated_at,
      company: user.company,
      name: user.name,
      lastUpdated: new Date().toISOString()
    }
    await this.tableClient.upsertEntity(entity)

    return entity
  }

  /**
   * Get a user entity
   * @param {string} login The login of the user
   * @returns {Promise<{partitionKey:string, rowKey:string, lastActivityDate: Date, lastUpdated: Date}>} The entity that was retrieved
   * @throws {Error} If the entity is not found
   */
  async getUser(login) {
    const entity = await this.tableClient.getEntity(login, login)
    return entity
  }

  /**
   * Bulk insert user logins
   * @param {Array<string>} userLogins The user logins to insert
   * @returns {Promise<void>} Resolves when the bulk insert is complete
   * @throws {Error} If the bulk insert fails
   * @async
   */
  async bulkInsert(userLogins) {
    const entities = userLogins.map(login => {
      return {
        partitionKey,
        rowKey: login,
        lastActivityDate: null,
        lastUpdated: null
      }
    })

    const transaction = new TableTransaction()

    for (const entity of entities) {
      transaction.createEntity(entity)
    }

    await this.tableClient.submitTransaction(transaction.actions)
  }
}

module.exports = { StorageTableClient }
