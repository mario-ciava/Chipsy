const logger = require("../../shared/logger");
const config = require("../../config");
const createCommandSync = require("../utils/commands/commandSync");
const { mapGuildRegistrationPayload } = require("../utils/interactionAccess");

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

async function primeGuildAccess(client) {
    const registrar = client?.accessControl?.registerGuilds;
    if (typeof registrar !== "function" || !client?.guilds?.cache) {
        return;
    }

    const payloads = [];
    client.guilds.cache.forEach((guild) => {
        const entry = mapGuildRegistrationPayload(guild);
        if (entry) {
            payloads.push(entry);
        }
    });

    if (!payloads.length) {
        return;
    }

    try {
        await registrar(payloads);
        logger.debug("Registered guild roster for access control", {
            scope: "events",
            event: "ready",
            guilds: payloads.length
        });
    } catch (error) {
        logger.warn("Failed to register guild roster for access control", {
            scope: "events",
            event: "ready",
            message: error?.message ?? String(error)
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
    await primeGuildAccess(client);

    const commandSync = client.commandSync || createCommandSync({ client, config });
    try {
        const slashCommands = client.commandRouter.getSlashCommandPayloads();
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
