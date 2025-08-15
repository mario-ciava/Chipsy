const mysql = require("mysql2/promise")
const { info, error } = require("./util/logger")
const ensureSchema = require("./util/mysqlcreator")

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const ensureDatabase = async(connectionOptions, database) => {
    const connection = await mysql.createConnection(connectionOptions)
    try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
        info("Ensured database exists", { scope: "mysql", database })
    } finally {
        await connection.end()
    }
}

const createPoolWithRetry = async(connectionOptions, database, retries = 5, baseDelay = 250) => {
    let attempt = 0
    let lastError = null

    while (attempt < retries) {
        attempt += 1
        try {
            info("Attempting to create MySQL connection pool", {
                scope: "mysql",
                attempt,
                host: connectionOptions.host,
                port: connectionOptions.port,
                database
            })

            const pool = mysql.createPool({
                ...connectionOptions,
                database,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            })

            pool.on("connection", (connection) => {
                info("MySQL connection established", {
                    scope: "mysql",
                    threadId: connection.threadId
                })
            })

            pool.on("error", (poolError) => {
                error("MySQL pool error", {
                    scope: "mysql",
                    message: poolError.message
                })
            })

            await pool.query("SELECT 1")
            info("MySQL connection pool created", {
                scope: "mysql",
                host: connectionOptions.host,
                port: connectionOptions.port,
                database
            })

            return pool
        } catch (err) {
            lastError = err
            error("Failed to create MySQL connection pool", {
                scope: "mysql",
                attempt,
                message: err.message
            })

            if (attempt >= retries) {
                break
            }

            const delay = baseDelay * Math.pow(2, attempt - 1)
            info("Retrying MySQL pool creation", { scope: "mysql", delay })
            await wait(delay)
        }
    }

    throw lastError
}

const createHealthCheck = (pool) => async() => {
    const [rows] = await pool.query("SELECT 1 AS alive")
    return { alive: rows.length > 0 }
}

const initializeMySql = async(client, config) => {
    const connectionOptions = {
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user ?? undefined,
        password: config.mysql.password ?? undefined
    }

    await ensureDatabase(connectionOptions, config.mysql.database)

    const pool = await createPoolWithRetry(connectionOptions, config.mysql.database)

    await ensureSchema(pool)

    const healthCheck = createHealthCheck(pool)

    client.connection = pool

    return { pool, healthCheck }
}

module.exports = initializeMySql
