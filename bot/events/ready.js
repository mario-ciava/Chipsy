const logger = require("../utils/logger");
const config = require("../../config");
const createCommandSync = require("../utils/commandSync");

async function synchronizeBotIdentity(client) {
    const desiredUsername = config.bot.displayName || "Chipsy";

    if (!client?.user || client.user.username === desiredUsername) {
        return;
    }

    try {
        await client.user.setUsername(desiredUsername);
        logger.debug(`Updated bot username to ${desiredUsername}`, {
            scope: "events",
            event: "ready",
            icon: "📝"
        });
    } catch (error) {
        logger.warn("Failed to update bot username", {
            scope: "events",
            event: "ready",
            message: error?.message ?? String(error),
            code: error?.code,
            status: error?.status
        });
    }
}

module.exports = async(client) => {
    const userTag = client?.user?.tag ?? "unknown user";
    logger.info(`Successfully logged-in as ${userTag}`, {
        scope: "events",
        event: "ready",
        icon: "🤖",
        guilds: client?.guilds?.cache?.size ?? 0
    });

    await synchronizeBotIdentity(client);

    const commandSync = client.commandSync || createCommandSync({ client, config });
    let slashCommands = [];
    try {
        // Get all command payloads
        slashCommands = client.commandRouter.getSlashCommandPayloads();

        logger.debug(`Preparing to register ${slashCommands.length} commands`, {
            scope: "events",
            event: "ready",
            commands: slashCommands.map(c => c.name)
        });

        await commandSync.synchronize({ reason: "ready", payloads: slashCommands });
    } catch (err) {
        logger.error("Failed to complete ready event setup", {
            scope: "events",
            event: "ready",
            message: err?.message ?? String(err),
            stack: err?.stack
        });
    }
};
