const EventEmitter = require("events")
const config = require("../config")
const { createClient } = require("./utils/createClient")
const loadEvents = require("./utils/eventloader")
const loadCommands = require("./utils/commands/commandloader")
const initializeMySql = require("./mysql")
const createDataHandler = require("../shared/database/dataHandler")
const createSetData = require("./utils/createSetData")
const logger = require("../shared/logger")
const createCacheClient = require("./utils/createCacheClient")
const createStatusService = require("../api/services/statusService")
const createCommandSync = require("./utils/commands/commandSync")
const { createAccessControlService } = require("../api/services/accessControlService")
const createCommandUsageLogger = require("./utils/commands/commandUsageLogger")
const startInternalServer = require("./internal/server")
const { createSettingsStore, createGameSettingsResolver } = require("../shared/settings")
const { cleanupExpiredLobbies } = require("./lobbies")

class WebSocketBridge extends EventEmitter {}
const webSocket = new WebSocketBridge()

const client = createClient(config)
client.commandSync = createCommandSync({ client, config })

let bootstrapPromise = null
let internalServer = null

const attachClientDiagnostics = () => {
    client.on("shardError", (error, shardId) => {
        logger.error("Discord shard error", {
            scope: "client",
            shardId,
            message: error?.message
        })
    })
    client.on("warn", (info) => {
        logger.warn("Discord client warning", {
            scope: "client",
            info: typeof info === "string" ? info : info?.message
        })
    })
    client.on("error", (error) => {
        logger.error("Discord client error", {
            scope: "client",
            message: error?.message
        })
    })
}

const bootstrap = async() => {
    if (bootstrapPromise) return bootstrapPromise

    const runBootstrap = async() => {
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

            const settingsStore = createSettingsStore({ pool, logger })
            const { resolveGameSettings, mergeLayers } = createGameSettingsResolver({
                settingsStore,
                logger
            })
            client.settingsStore = settingsStore
            client.resolveGameSettings = resolveGameSettings
            client.mergeGameSettingsLayers = mergeLayers

            if (!internalServer) {
                try {
                    internalServer = startInternalServer({
                        client,
                        webSocket,
                        statusService,
                        config: config.internalApi
                    })
                } catch (error) {
                    logger.error("Failed to start internal control server", {
                        scope: "internal",
                        message: error.message
                    })
                    throw error
                }
            }

            attachClientDiagnostics()

            const token = config.discord?.botToken || ""
            const tokenPreview = typeof token === "string" && token.length >= 8
                ? `${token.slice(0, 4)}…${token.slice(-4)}`
                : null
            logger.info("Logging in to Discord", {
                scope: "bootstrap",
                tokenPresent: Boolean(token),
                tokenPreview
            })

            await client.login(token)
            logger.info("Discord client authenticated", { scope: "bootstrap", icon: "🔐" })

            // Start periodic cleanup of expired public lobbies
            setInterval(() => {
                cleanupExpiredLobbies(pool).catch((err) => {
                    logger.error("Failed to cleanup expired lobbies", { scope: "system", error: err.message })
                })
            }, 10 * 60 * 1000)

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
    }

    bootstrapPromise = runBootstrap().catch((error) => {
        bootstrapPromise = null
        throw error
    })

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
            if (internalServer?.close) {
                await internalServer.close()
                internalServer = null
            }

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
