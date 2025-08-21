const { error: logError } = require("./logger")

const handlers = {
    ready: require("../events/ready"),
    messageCreate: require("../events/msg"),
    interactionCreate: require("../events/interaction"),
    uncaughtException: require("../events/uncaughtException"),
    unhandledRejection: require("../events/unhandledRejection")
}

const executeSafely = async(eventName, handler, args) => {
    try {
        await handler(...args)
    } catch (error) {
        logError("Event handler failed", {
            scope: "events",
            event: eventName,
            message: error?.message ?? String(error)
        })
    }
}

module.exports = (client, _config) => {
    client
        .on("ready", () => executeSafely("ready", handlers.ready, [client]))
        .on("messageCreate", (msg) => executeSafely("messageCreate", handlers.messageCreate, [msg]))
        .on("interactionCreate", (interaction) =>
            executeSafely("interactionCreate", handlers.interactionCreate, [interaction])
        )

    process
        .on("uncaughtException", (...args) =>
            executeSafely("uncaughtException", handlers.uncaughtException, args)
        )
        .on("unhandledRejection", (...args) =>
            executeSafely("unhandledRejection", handlers.unhandledRejection, args)
        )
}
