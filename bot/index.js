const EventEmitter = require("events")
const config = require("./config")
const { createClient } = require("./utils/createClient")
const loadEvents = require("./utils/eventloader")
const loadCommands = require("./utils/commandloader")
const initializeMySql = require("./mysql")
const createDataHandler = require("./utils/datahandler")
const createSetData = require("./utils/createSetData")
const logger = require("./utils/logger")
const createCacheClient = require("./utils/createCacheClient")
const createStatusService = require("../server/services/statusService")

class WebSocketBridge extends EventEmitter {}
const webSocket = new WebSocketBridge()

const client = createClient(config)

let bootstrapPromise = null

const bootstrap = async() => {
    if (bootstrapPromise) return bootstrapPromise

    bootstrapPromise = (async() => {
        logger.info("Bootstrap started", { scope: "bootstrap" })

        try {
            await loadEvents(client)
            logger.info("Events loaded", { scope: "bootstrap" })

            await loadCommands(client, config)
            logger.info("Commands loaded", { scope: "bootstrap" })

            const { pool, healthCheck } = await initializeMySql(client, config)
            const health = await healthCheck()
            logger.info("Database health check completed", { scope: "mysql", ...health })

            const dataHandler = createDataHandler(pool)
            client.dataHandler = dataHandler
            client.SetData = createSetData(dataHandler)
            client.healthChecks = { mysql: healthCheck }

            const cache = await createCacheClient(config.cache?.redis)
            client.cache = cache

            const statusService = createStatusService({
                client,
                cache,
                webSocket
            })
            client.statusService = statusService

            await client.login(config.discord.botToken)
            logger.info("Discord client logged in", { scope: "bootstrap" })
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

if (require.main === module) {
    bootstrap().catch(() => {
        process.exit(1)
    })
}

module.exports = {
    client,
    bootstrap,
    webSocket
}
