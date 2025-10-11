const EventEmitter = require("events")
const createServer = require("./express")
const logger = require("../shared/logger")
const config = require("../config")
const createMysqlPool = require("./services/mysqlPool")
const createSessionStore = require("./services/sessionStoreFactory")
const createStatusBridge = require("./services/statusBridge")
const createAdminBridge = require("./services/adminBridge")
const InternalBotClient = require("./services/internalBotClient")
const createDiscordDirectory = require("./services/discordDirectory")
const createDataHandler = require("../shared/database/dataHandler")
const { createAccessControlService } = require("./services/accessControlService")

const webSocket = new EventEmitter()

let httpServer = null
let mysqlPool = null
let rpcClient = null

const gracefulShutdown = async(signal) => {
    logger.info(`Received ${signal} - Starting graceful shutdown...`, { scope: "server" })
    try {
        if (httpServer) {
            await new Promise((resolve, reject) => {
                httpServer.close((error) => (error ? reject(error) : resolve()))
            })
            logger.info("HTTP server closed", { scope: "server" })
        }

        if (mysqlPool) {
            await mysqlPool.end()
            logger.info("MySQL pool closed", { scope: "mysql" })
        }

        process.exit(0)
    } catch (error) {
        logger.error("Error during graceful shutdown", {
            scope: "server",
            message: error.message
        })
        process.exit(1)
    }
}

const start = async() => {
    try {
        const { pool, healthCheck } = await createMysqlPool(config.mysql)
        mysqlPool = pool

        const dataHandler = createDataHandler(pool)
        const accessControl = createAccessControlService({
            pool,
            ownerId: config.discord.ownerId,
            logger
        })

        const sessionStore = createSessionStore({
            session: require("express-session"),
            pool
        })

        rpcClient = new InternalBotClient()
        const discordDirectory = createDiscordDirectory({ rpcClient })
        const statusService = createStatusBridge({
            rpcClient,
            webSocket
        })
        const adminService = createAdminBridge({
            rpcClient,
            webSocket,
            statusService
        })

        const clientFacade = {
            config: {
                id: config.discord.clientId,
                secret: config.discord.clientSecret,
                redirectUri: config.web.redirectOrigin,
                ownerid: config.discord.ownerId,
                enabled: config.bot.enabled
            },
            logger,
            statusService,
            dataHandler,
            accessControl,
            users: discordDirectory.users,
            guilds: discordDirectory.guilds,
            healthChecks: {
                mysql: healthCheck,
                discord: async() => {
                    try {
                        const health = await rpcClient.getDiscordHealth()
                        return { alive: Boolean(health?.alive), ...health }
                    } catch (error) {
                        return { alive: false, error: error.message }
                    }
                }
            }
        }
        clientFacade.mysqlPool = pool

        const port = Number(process.env.PORT) || config.constants.server.defaultPort

        const app = createServer(clientFacade, webSocket, {
            port,
            listen: true,
            statusService,
            sessionStore,
            adminService,
            dataHandler,
            accessControl,
            discordDirectory
        })

        httpServer = app.httpServer

        httpServer.on("error", (error) => {
            logger.error("HTTP server error", {
                scope: "server",
            message: error.message,
                code: error.code
            })

            if (error.code === "EADDRINUSE") {
                logger.error(`Port ${port} is already in use. Please free the port or change PORT in .env`, {
                    scope: "server"
                })
                process.exit(1)
            }
        })

        logger.info(`Control panel listening on port ${port}`, { scope: "server" })
        logger.info("Press Ctrl+C to shutdown gracefully", { scope: "server" })
    } catch (error) {
        logger.error("Failed to start control panel server", {
            scope: "server",
            message: error.message,
            stack: error.stack
        })
        process.exit(1)
    }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception detected", {
        scope: "server",
        message: error.message,
        stack: error.stack
    })
    gracefulShutdown("uncaughtException")
})

process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection detected", {
        scope: "server",
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    })
    gracefulShutdown("unhandledRejection")
})

start()
