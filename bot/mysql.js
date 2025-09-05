const mysql = require("mysql2/promise")
const logger = require("./utils/logger")
const ensureSchema = require("./utils/mysqlcreator")
const constants = require("../config/constants")
const { sleep } = require("./utils/helpers")

/**
 * Crea il database se non esiste.
 * Gestisce la connessione in modo sicuro con cleanup garantito.
 */
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
    retries = constants.retry.mysql.maxAttempts,
    baseDelay = constants.retry.mysql.baseDelay
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
             * Gestisce errori a livello di pool (connessioni perse, timeout, etc.)
             * IMPORTANTE: Questo handler previene il crash dell'app ma non ripristina
             * automaticamente il pool. Le query successive potrebbero fallire fino
             * al prossimo retry o restart del bot.
             */
            pool.on("error", (poolError) => {
                logger.error("MySQL pool error detected", {
                    scope: "mysql",
                    message: poolError.message,
                    code: poolError.code,
                    fatal: poolError.fatal || false
                })

                // Se l'errore è fatale (es. connessione persa), logga un warning più severo
                if (poolError.fatal) {
                    logger.error("FATAL MySQL pool error - connection lost", {
                        scope: "mysql",
                        message: poolError.message,
                        hint: "Il bot potrebbe necessitare un restart per ripristinare la connessione"
                    })
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

    // Lancia un errore descrittivo dopo tutti i tentativi falliti
    const finalError = new Error(
        `Failed to create MySQL pool after ${retries} attempts: ${lastError?.message || "Unknown error"}`
    )
    finalError.originalError = lastError
    throw finalError
}

/**
 * Crea una funzione di health check per verificare lo stato del pool MySQL
 */
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

/**
 * Chiude il pool MySQL in modo sicuro.
 * Attende il completamento delle query in corso prima di chiudere.
 * @param {mysql.Pool} pool - Il pool da chiudere
 * @param {number} timeout - Timeout in ms (da constants.timeouts.mysqlShutdown)
 */
const shutdownPool = async(pool, timeout = constants.timeouts.mysqlShutdown) => {
    if (!pool) {
        logger.debug("No MySQL pool to shutdown", { scope: "mysql" })
        return
    }

    logger.info("Closing MySQL pool", { scope: "mysql", icon: "🛑" })

    try {
        // Crea una promise con timeout per evitare hang indefiniti
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
        // Forza la chiusura se il graceful shutdown fallisce
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

/**
 * Inizializza la connessione MySQL con:
 * - Creazione database e schema
 * - Retry logic per gestire MySQL non ancora pronto
 * - Health check per monitoraggio
 * - Graceful shutdown function
 *
 * NOTA: L'host MySQL deve essere già configurato correttamente in config.mysql.host.
 * La detection dell'ambiente (localhost vs Docker) è gestita da devRunner.mjs.
 *
 * @param {Object} client - Client Discord.js con configurazione
 * @param {Object} config - Configurazione MySQL (già validata da bot/config.js)
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

    // Crea il database se non esiste
    await ensureDatabase(connectionOptions, config.mysql.database)

    // Crea il pool con retry automatico
    const pool = await createPoolWithRetry(connectionOptions, config.mysql.database)

    // Inizializza lo schema (tabelle, indici, etc.)
    await ensureSchema(pool)

    const healthCheck = createHealthCheck(pool)
    const shutdown = () => shutdownPool(pool)

    // Salva il pool nel client per accesso globale
    client.connection = pool

    return { pool, healthCheck, shutdown }
}

module.exports = initializeMySql
