const logger = require("../utils/logger")

module.exports = async(client) => {
    const userTag = client?.user?.tag ?? "unknown user"
    logger.info(`Successfully logged-in as ${userTag}`, {
        scope: "events",
        event: "ready",
        icon: "🤖",
        guilds: client?.guilds?.cache?.size ?? 0
    })

    try {
        const desiredUsername = process.env.BOT_DISPLAY_NAME || "Chipsy"
        if (client?.user && client.user.username !== desiredUsername) {
            await client.user.setUsername(desiredUsername)
            logger.debug(`Updated bot username to ${desiredUsername}`, {
                scope: "events",
                event: "ready",
                icon: "📝"
            })
        }

        const slashCommands = client.commandRouter.getSlashCommandPayloads()
        const result = await client.application.commands.set(slashCommands)
        logger.info(
            `Registered ${result.size} slash command(s)`,
            {
                scope: "events",
                event: "ready",
                icon: "🛠️",
                commands: slashCommands.map((c) => c.name)
            }
        )
    } catch (err) {
        logger.error("Failed to register application commands", {
            scope: "events",
            event: "ready",
            message: err?.message ?? String(err)
        })
    }
}
