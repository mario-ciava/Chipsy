const fs = require("fs/promises")
const path = require("path")

module.exports = async(client, _config) => {
    const commandsPath = path.join(__dirname, "..", "commands")

    let files
    try {
        files = await fs.readdir(commandsPath)
    } catch (error) {
        console.error("Failed to read commands directory:", error)
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

            if (typeof command.run !== "function") {
                throw new Error(`Command '${file}' is missing the required 'run' function.`)
            }

            client.commandRouter.register(command)
        } catch (error) {
            console.error(`Failed to load command '${file}':`, error)
            throw error
        }
    }
}
