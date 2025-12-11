const path = require("path")
const CommandRegistry = require("./commandRegistry")

let registry = null

const buildOptions = (config = {}) => {
    const hotReload = config?.bot?.commands || {}
    return {
        watch: hotReload.watch !== false,
        reloadDebounceMs: typeof hotReload.reloadDebounceMs === "number"
            ? hotReload.reloadDebounceMs
            : 750,
        syncOnChange: hotReload.syncOnChange !== false,
        syncDebounceMs: typeof hotReload.syncDebounceMs === "number"
            ? hotReload.syncDebounceMs
            : 4000
    }
}

module.exports = async(client, config) => {
    if (!registry) {
        registry = new CommandRegistry({
            client,
        commandsPath: path.join(__dirname, "..", "..", "commands"),
            options: buildOptions(config)
        })
        client.commandRegistry = registry
    }

    return registry.initialize()
}
