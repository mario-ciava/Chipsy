const EventEmitter = require("events")
const config = require("./config")
const { createClient } = require("./util/createClient")
const loadEvents = require("./util/eventloader")
const loadCommands = require("./util/commandloader")
const initializeMySql = require("./mysql")
const createDataHandler = require("./util/datahandler")
const createSetData = require("./util/createSetData")
const logger = require("./util/logger")

class WebSocketBridge extends EventEmitter {}
const webSocket = new WebSocketBridge()

const client = createClient(config)

const bootstrap = async() => {
    logger.info("Bootstrap started", { scope: "bootstrap" })

    try {
        await loadEvents(client, config)
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

        await client.login(config.discord.botToken)
        logger.info("Discord client logged in", { scope: "bootstrap" })
    } catch (error) {
        logger.error("Failed to initialize the application", {
            scope: "bootstrap",
            message: error.message
        })
        process.exit(1)
    }
}

bootstrap()

module.exports = {
    client,
    bootstrap,
    webSocket
}
