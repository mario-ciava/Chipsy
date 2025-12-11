const mysql = require("mysql2/promise")
const logger = require("../shared/logger")
const ensureSchema = require("../shared/database/ensureSchema")
const { constants } = require("../config")
const { sleep } = require("./utils/helpers")

/** Creates the database if ops forgot to do their job. */
const ensureDatabase = async(connectionOptions, database) => {
    let connection = null
    try {
        connection = await mysql.createConnection(connectionOptions)
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
        logger.debug("Ensured database exists", { scope: "mysql", database })
    } catch (err) {
        logger.error("Failed to ensure database exists", {
            scope: "mysql",
            icon: "❌",
            database,
            message: err.message
        })
        throw err
    } finally {
        if (connection) {
            try {
                await connection.end()
            } catch (closeErr) {
                logger.error("Failed to close connection after database creation", {
                    scope: "mysql",
                    message: closeErr.message
                })
            }
        }
    }
}

const createPoolWithRetry = async(
    connectionOptions,
    database,
    {
        retries = constants.retry.mysql.maxAttempts,
        baseDelay = constants.retry.mysql.baseDelay,
        onPoolError
    } = {}
) => {
    let attempt = 0
    let lastError = null

    while (attempt < retries) {
        attempt += 1
        let pool
        try {
            logger.debug("Attempting MySQL connection", {
                scope: "mysql",
                attempt,
                host: connectionOptions.host,
                port: connectionOptions.port,
                database
            })

            pool = mysql.createPool({
                ...connectionOptions,
                database,
                waitForConnections: constants.database.pool.waitForConnections,
                connectionLimit: constants.database.pool.connectionLimit,
                queueLimit: constants.database.pool.queueLimit
            })

            pool.on("connection", (connection) => {
                logger.debug("MySQL connection established", {
                    scope: "mysql",
                    threadId: connection.threadId
                })
            })

            /**
             * Pool-level error babysitter: keeps the bot alive but won't magically fix the pool.
             * Translation: expect broken queries until the next recovery or restart.
             */
            pool.on("error", (poolError) => {
                logger.error("MySQL pool error detected", {
                    scope: "mysql",
                    message: poolError.message,
                    code: poolError.code,
                    fatal: poolError.fatal || false
                })

                // Fatal? yell louder so someone maybe reads the logs.
                if (poolError.fatal) {
                    logger.error("FATAL MySQL pool error - connection lost", {
                        scope: "mysql",
                        message: poolError.message,
                        hint: "Manual restart likely required to resurrect the connection"
                    })
                }

                if (typeof onPoolError === "function") {
                    try {
                        onPoolError(poolError)
                    } catch (handlerError) {
                        logger.error("MySQL pool error handler failed", {
                            scope: "mysql",
                            message: handlerError.message
                        })
                    }
                }
            })

            await pool.query("SELECT 1")
            logger.info("MySQL connected", {
                scope: "mysql",
                icon: "🔌",
                host: connectionOptions.host,
                port: connectionOptions.port,
                database,
                attempt
            })

            return pool
        } catch (err) {
            lastError = err
            if (pool) {
                try {
                    await pool.end()
                } catch (closeError) {
                    logger.warn("Failed to close MySQL pool after failed attempt", {
                        scope: "mysql",
                        attempt,
                        message: closeError.message
                    })
                }
            }
            logger.warn("Failed to create MySQL connection", {
                scope: "mysql",
                attempt,
                code: err.code,
                message: err.message
            })

            if (attempt >= retries) {
                break
            }

            const retryDelay = baseDelay * Math.pow(2, attempt - 1)
            logger.warn("Retrying MySQL connection", {
                scope: "mysql",
                icon: "🔁",
                attempt: attempt + 1,
                delayMs: retryDelay
            })
            await sleep(retryDelay)
        }
    }

    // After burning all retries, throw something the caller can't ignore.
    const finalError = new Error(
        `Failed to create MySQL pool after ${retries} attempts: ${lastError?.message || "Unknown error"}`
    )
    finalError.originalError = lastError
    throw finalError
}

/** Bare-bones health check: if SELECT 1 fails, the pool is toast. */
const createHealthCheck = (pool) => async() => {
    try {
        const [rows] = await pool.query("SELECT 1 AS alive")
        return { alive: rows.length > 0 }
    } catch (err) {
        logger.warn("MySQL health check failed", {
            scope: "mysql",
            message: err.message
        })
        return { alive: false, error: err.message }
    }
}

/** Gracefully shut down the pool; try nice first, then slam the door. */
const shutdownPool = async(pool, timeout = constants.timeouts.mysqlShutdown) => {
    if (!pool) {
        logger.debug("No MySQL pool to shutdown", { scope: "mysql" })
        return
    }

    logger.info("Closing MySQL pool", { scope: "mysql", icon: "🛑" })

    try {
        // Timeout guard so shutdown doesn't hang forever.
        await Promise.race([
            pool.end(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Pool shutdown timeout")), timeout)
            )
        ])
        logger.info("MySQL pool closed", { scope: "mysql", icon: "✅" })
    } catch (err) {
        logger.error("Failed to close MySQL pool gracefully", {
            scope: "mysql",
            message: err.message
        })
        // Graceful failed, so we brute-force it.
        try {
            await pool.end()
        } catch (forceErr) {
            logger.error("Failed to force close MySQL pool", {
                scope: "mysql",
                message: forceErr.message
            })
        }
    }
}

const createPoolProxy = (initialPool) => {
    let currentPool = initialPool

    const proxy = new Proxy(
        {},
        {
            get(_target, prop) {
                if (!currentPool) return undefined
                const value = currentPool[prop]
                if (typeof value === "function") {
                    return value.bind(currentPool)
                }
                return value
            }
        }
    )

    const setPool = (nextPool) => {
        currentPool = nextPool
    }

    const getPool = () => currentPool

    return { proxy, setPool, getPool }
}

/**
 * Bootstraps MySQL: create schema, spin up a pool with retries, bolt on health checks, wire shutdowns.
 * @param {Object} client - Discord client config container
 * @param {Object} config - Parsed config.mysql settings
 * @returns {Object} { pool, healthCheck, shutdown }
 */
const initializeMySql = async(client, config) => {
    const host = config.mysql.host

    const connectionOptions = {
        host,
        port: config.mysql.port,
        user: config.mysql.user ?? undefined,
        password: config.mysql.password ?? undefined
    }

    logger.info("Connecting to MySQL", {
        scope: "mysql",
        icon: "🔌",
        host,
        port: config.mysql.port,
        database: config.mysql.database
    })

    // Make sure the schema exists before the pool pretends everything is fine.
    await ensureDatabase(connectionOptions, config.mysql.database)

    let handlePoolError
    let poolProxyState = null
    const recoveryTracker = (() => {
        let recoveryPromise = null

        const startRecovery = (reason) => {
            if (recoveryPromise) {
                logger.warn("MySQL pool recovery already in progress", {
                    scope: "mysql",
                    reason
                })
                return recoveryPromise
            }

            recoveryPromise = (async() => {
                let attempt = 0
                while (true) {
                    attempt += 1
                    try {
                        logger.warn("Attempting to recover MySQL pool", {
                            scope: "mysql",
                            attempt,
                            reason
                        })

                        const nextPool = await createPoolWithRetry(connectionOptions, config.mysql.database, {
                            onPoolError: handlePoolError
                        })

                        await ensureSchema(nextPool)
                        const previousPool = poolProxyState?.getPool ? poolProxyState.getPool() : null

                        if (poolProxyState?.setPool) {
                            poolProxyState.setPool(nextPool)
                        } else {
                            logger.error("MySQL pool proxy not initialized; unable to swap pool reference", {
                                scope: "mysql"
                            })
                        }

                        if (previousPool && previousPool !== nextPool) {
                            shutdownPool(previousPool).catch((error) => {
                                logger.warn("Failed to shutdown previous MySQL pool instance", {
                                    scope: "mysql",
                                    message: error.message
                                })
                            })
                        }

                        logger.info("MySQL pool recovered", {
                            scope: "mysql",
                            icon: "✅",
                            attempt
                        })
                        return nextPool
                    } catch (error) {
                        logger.error("MySQL pool recovery attempt failed", {
                            scope: "mysql",
                            attempt,
                            message: error.message
                        })
                        const delay = Math.min(constants.retry.mysql.baseDelay * Math.pow(2, attempt - 1), 30000)
                        await sleep(delay)
                    }
                }
            })().finally(() => {
                recoveryPromise = null
            })

            return recoveryPromise
        }

        return { startRecovery }
    })()

    handlePoolError = (poolError) => {
        if (!poolError?.fatal) {
            return
        }

        logger.warn("Fatal MySQL pool error detected - scheduling recovery", {
            scope: "mysql",
            code: poolError.code,
            message: poolError.message
        })
        recoveryTracker.startRecovery(poolError.code || "unknown")
    }

    const primaryPool = await createPoolWithRetry(connectionOptions, config.mysql.database, {
        onPoolError: handlePoolError
    })

    await ensureSchema(primaryPool)

    poolProxyState = createPoolProxy(primaryPool)
    const poolProxy = poolProxyState.proxy

    const healthCheck = createHealthCheck(poolProxy)
    const shutdown = () => shutdownPool(poolProxyState?.getPool?.())

    // Stuff the proxy on the client so legacy code keeps working.
    client.connection = poolProxy

    return { pool: poolProxy, healthCheck, shutdown }
}

module.exports = initializeMySql
