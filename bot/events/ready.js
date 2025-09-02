const { info, error } = require("../utils/logger")

module.exports = async(client) => {
    const userTag = client?.user?.tag ?? "unknown user"
    info(`Successfully logged-in as ${userTag}`, { scope: "events", event: "ready" })

    try {
        const desiredUsername = process.env.BOT_DISPLAY_NAME || "Chipsy"
        if (client?.user && client.user.username !== desiredUsername) {
            await client.user.setUsername(desiredUsername)
            info(`Updated bot username to ${desiredUsername}`, { scope: "events", event: "ready" })
        }

        const slashCommands = client.commandRouter.getSlashCommandPayloads()
        const result = await client.application.commands.set(slashCommands)
        info(`Registered ${result.size} slash command(s): ${slashCommands.map(c => c.name).join(', ')}`, { scope: "events", event: "ready" })
    } catch (err) {
        error("Failed to register application commands", {
            scope: "events",
            event: "ready",
            message: err?.message ?? String(err)
        })
    }
}
