const fs = require("fs/promises")
const path = require("path")

module.exports = async(client) => {
    try {
        const commandsPath = path.join(__dirname, "..", "commands")
        const files = await fs.readdir(commandsPath)

        for (const file of files) {
            if (!file.endsWith(".js")) continue
            const command = require(path.join(commandsPath, file))

            if (!command || typeof command.execute !== "function") {
                console.warn(`Command loader skipped '${file}' because it does not export an executable command.`)
                continue
            }

            client.commandRouter.register(command)
        }
    } catch (error) {
        console.error("Failed to load commands:", error)
    }
}
