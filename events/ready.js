const path = require("path")
const fs = require("fs/promises")
const { info, warn, error } = require("../util/logger")

module.exports = async(client) => {
    const userTag = client?.user?.tag ?? "unknown user"
    info(`Successfully logged-in as ${userTag}`, { scope: "events", event: "ready" })

    try {
        const desiredUsername = process.env.BOT_DISPLAY_NAME || "Chipsy"
        if (client?.user && client.user.username !== desiredUsername) {
            await client.user.setUsername(desiredUsername)
            info(`Updated bot username to ${desiredUsername}`, { scope: "events", event: "ready" })
        }

        const shouldUpdateAvatar = process.env.BOT_UPDATE_AVATAR !== "false"
        const desiredAvatarPath = process.env.BOT_AVATAR_PATH || path.join(__dirname, "..", "assets", "brand", "Chipsy.png")
        if (shouldUpdateAvatar && client?.user && !client.config?.avatarApplied) {
            try {
                const avatarFile = await fs.readFile(desiredAvatarPath)
                await client.user.setAvatar(avatarFile)
                client.config.avatarApplied = true
                info("Updated bot avatar", { scope: "events", event: "ready" })
            } catch (avatarError) {
                warn("Unable to update bot avatar", {
                    scope: "events",
                    event: "ready",
                    message: avatarError.message
                })
            }
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
