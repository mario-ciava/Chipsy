const { error: logError } = require("./logger")

const { Events } = require("discord.js")

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
        .once(Events.ClientReady, () => executeSafely("ClientReady", handlers.ready, [client]))
        .on(Events.MessageCreate, (msg) => executeSafely("MessageCreate", handlers.messageCreate, [msg]))
        .on(Events.InteractionCreate, (interaction) =>
            executeSafely("InteractionCreate", handlers.interactionCreate, [interaction])
        )

    process
        .on("uncaughtException", (...args) =>
            executeSafely("uncaughtException", handlers.uncaughtException, args)
        )
        .on("unhandledRejection", (...args) =>
            executeSafely("unhandledRejection", handlers.unhandledRejection, args)
        )
}
