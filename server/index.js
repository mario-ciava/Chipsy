const createServer = require("./express")
const { client, webSocket, bootstrap } = require("../app")
const logger = require("../util/logger")

const start = async() => {
    try {
        await bootstrap()

        const port = Number(process.env.PORT) || 3000
        createServer(client, webSocket, { port, listen: true })

        logger.info(`Control panel listening on port ${port}`, { scope: "server" })
    } catch (error) {
        logger.error("Failed to start control panel server", {
            scope: "server",
            message: error.message
        })
        process.exit(1)
    }
}

start()
