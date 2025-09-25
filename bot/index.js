const EventEmitter = require("events")
const config = require("../config")
const { createClient } = require("./utils/createClient")
const loadEvents = require("./utils/eventloader")
const loadCommands = require("./utils/commandloader")
const initializeMySql = require("./mysql")
const createDataHandler = require("./utils/datahandler")
const createSetData = require("./utils/createSetData")
const logger = require("./utils/logger")
const createCacheClient = require("./utils/createCacheClient")
const createStatusService = require("../server/services/statusService")
const createCommandSync = require("./utils/commandSync")
const { createAccessControlService } = require("../server/services/accessControlService")
const createCommandUsageLogger = require("./utils/commandUsageLogger")

class WebSocketBridge extends EventEmitter {}
const webSocket = new WebSocketBridge()

const client = createClient(config)
client.commandSync = createCommandSync({ client, config })

let bootstrapPromise = null

const bootstrap = async() => {
    if (bootstrapPromise) return bootstrapPromise

    bootstrapPromise = (async() => {
        logger.info("Starting Chipsy bot", { scope: "bootstrap", icon: "🚀" })

        try {
            await loadEvents(client)
            logger.debug("Events loaded", { scope: "bootstrap" })

            await loadCommands(client, config)
            logger.debug("Commands loaded", { scope: "bootstrap" })

            const { pool, healthCheck, shutdown } = await initializeMySql(client, config)
            const health = await healthCheck()
            logger.debug("Database health check completed", { scope: "mysql", ...health })

            const dataHandler = createDataHandler(pool)
            client.dataHandler = dataHandler
            client.SetData = createSetData(dataHandler)
            client.commandLogger = createCommandUsageLogger({ pool, logger })

            client.accessControl = createAccessControlService({
                pool,
                ownerId: config.discord.ownerId,
                logger
            })

            client.healthChecks = { mysql: healthCheck }
            client.mysqlShutdown = shutdown // Salva la funzione di shutdown per graceful shutdown

            const cache = await createCacheClient(config.cache?.redis)
            client.cache = cache

            const statusService = createStatusService({
                client,
                cache,
                webSocket
            })
            client.statusService = statusService

            await client.login(config.discord.botToken)
            logger.info("Discord client authenticated", { scope: "bootstrap", icon: "🔐" })

            // Ritorna l'oggetto con le funzioni di shutdown per graceful shutdown
            return {
                mysql: {
                    pool,
                    healthCheck,
                    shutdown
                }
            }
        } catch (error) {
            logger.error("Failed to initialize the application", {
                scope: "bootstrap",
                message: error.message
            })
            throw error
        }
    })()

    return bootstrapPromise
}

// ============================================================================
// STANDALONE MODE: Graceful shutdown quando il bot viene eseguito direttamente
// ============================================================================
if (require.main === module) {
    let isShuttingDown = false

    const gracefulShutdown = async(signal) => {
        if (isShuttingDown) return
        isShuttingDown = true

        logger.info(`Received ${signal} - Starting graceful shutdown...`, { scope: "bot" })

        try {
            // Chiudi il pool MySQL
            if (client.mysqlShutdown) {
                await client.mysqlShutdown()
            }

            // Chiudi il client Discord
            if (client.isReady()) {
                await client.destroy()
            }

            logger.info("Bot shutdown completed successfully", { scope: "bot" })
            process.exit(0)
        } catch (error) {
            logger.error("Error during bot shutdown", {
                scope: "bot",
                message: error.message
            })
            process.exit(1)
        }
    }

    process.on("SIGINT", () => gracefulShutdown("SIGINT"))
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

    process.on("uncaughtException", (error) => {
        logger.error("Uncaught exception in bot", {
            scope: "bot",
            message: error.message,
            stack: error.stack
        })
        gracefulShutdown("uncaughtException")
    })

    process.on("unhandledRejection", (reason) => {
        logger.error("Unhandled rejection in bot", {
            scope: "bot",
            reason: reason instanceof Error ? reason.message : String(reason)
        })
        gracefulShutdown("unhandledRejection")
    })

    bootstrap().catch((error) => {
        logger.error("Bootstrap failed", { scope: "bot", message: error.message })
        process.exit(1)
    })
}

module.exports = {
    client,
    bootstrap,
    webSocket
}
