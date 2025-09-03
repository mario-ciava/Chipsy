const fs = require("fs/promises")
const path = require("path")
const logger = require("./logger")

module.exports = async(client, _config) => {
    const commandsPath = path.join(__dirname, "..", "commands")

    let files
    try {
        files = await fs.readdir(commandsPath)
    } catch (error) {
        logger.error("Failed to read commands directory", {
            scope: "commandLoader",
            path: commandsPath,
            error: error.message,
            stack: error.stack
        })
        throw error
    }

    for (const file of files) {
        if (!file.endsWith(".js")) continue

        const filePath = path.join(commandsPath, file)

        try {
            delete require.cache[require.resolve(filePath)]
            const command = require(filePath)

            if (!command || typeof command !== "object") {
                throw new Error(`Command '${file}' did not export a valid module.`)
            }

            if (!command.config) {
                throw new Error(`Command '${file}' is missing the required 'config' export.`)
            }

            if (typeof command.execute !== "function") {
                throw new Error(`Command '${file}' is missing the required 'execute' function.`)
            }

            client.commandRouter.register(command)
        } catch (error) {
            logger.error("Failed to load command", {
                scope: "commandLoader",
                file,
                filePath,
                error: error.message,
                stack: error.stack
            })
            throw error
        }
    }
}
