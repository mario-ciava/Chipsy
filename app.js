const EventEmitter = require("events")
const config = require("./config")
const { createClient } = require("./util/createClient")
const loadEvents = require("./util/eventloader")
const loadCommands = require("./util/commandloader")
const initializeMySql = require("./mysql")
const createDataHandler = require("./util/datahandler")
const createSetData = require("./util/createSetData")

class WebSocketBridge extends EventEmitter {}
const webSocket = new WebSocketBridge()

const client = createClient(config)

const bootstrap = async() => {

    try {
        await loadEvents(client, config)
        await loadCommands(client, config)
        const connection = await initializeMySql(client, config)
        const dataHandler = createDataHandler(connection)
        client.dataHandler = dataHandler
        client.SetData = createSetData(dataHandler)

        await client.login(config.discord.botToken)
    } catch (error) {
        console.error("Failed to initialize the application:", error)
        process.exit(1)
    }
}

bootstrap()

module.exports = {
    client,
    bootstrap,
    webSocket
}
