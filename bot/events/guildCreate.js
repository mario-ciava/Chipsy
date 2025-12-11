const logger = require("../../shared/logger")
const { mapGuildRegistrationPayload } = require("../utils/interactionAccess")

module.exports = async(guild) => {
    if (!guild) return
    const client = guild.client
    const accessControl = client?.accessControl
    if (!accessControl || typeof accessControl.registerGuild !== "function") {
        return
    }

    const payload = mapGuildRegistrationPayload(guild)
    if (!payload) return

    try {
        const record = await accessControl.registerGuild(payload)
        if (record?.status && record.status !== "approved") {
            logger.warn("Guild quarantined after invite", {
                scope: "guilds",
                guildId: guild.id,
                status: record.status,
                name: guild.name
            })
        } else {
            logger.info("Guild registered after invite", {
                scope: "guilds",
                guildId: guild.id,
                name: guild.name
            })
        }
    } catch (error) {
        logger.error("Failed to register guild after invite", {
            scope: "guilds",
            guildId: guild.id,
            message: error.message
        })
    }
}
