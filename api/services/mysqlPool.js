const mysql = require("mysql2/promise")
const { constants } = require("../../config")
const logger = require("../../shared/logger")

const createMysqlPool = async(mysqlConfig) => {
    if (!mysqlConfig) {
        throw new Error("MySQL configuration missing")
    }

    const pool = mysql.createPool({
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        user: mysqlConfig.user,
        password: mysqlConfig.password,
        database: mysqlConfig.database,
        waitForConnections: constants.database.pool.waitForConnections,
        connectionLimit: constants.database.pool.connectionLimit,
        queueLimit: constants.database.pool.queueLimit
    })

    logger.info("API MySQL pool initialized", {
        scope: "mysql",
        host: mysqlConfig.host,
        port: mysqlConfig.port,
        database: mysqlConfig.database
    })

    const healthCheck = async() => {
        try {
            const [rows] = await pool.query("SELECT 1 AS alive")
            return { alive: rows.length > 0 }
        } catch (error) {
            return { alive: false, error: error.message }
        }
    }

    return { pool, healthCheck }
}

module.exports = createMysqlPool
