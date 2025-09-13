const logger = require("../utils/logger");
const config = require("../config");
const { diffCommands, logDiff } = require("../utils/commandDiffer");

/**
 * Register commands for a specific guild
 * @param {Client} client - Discord client
 * @param {string} guildId - Guild ID
 * @param {Array} commandPayloads - Command payloads to register
 * @returns {Promise<Collection>}
 */
async function registerGuildCommands(client, guildId, commandPayloads) {
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            logger.warn(`Test guild ${guildId} not found - bot not in that guild`, {
                scope: "events",
                event: "ready"
            });
            return null;
        }

        // Fetch existing guild commands
        const existingCommands = await guild.commands.fetch();
        const existingPayloads = existingCommands.map(cmd => cmd.toJSON());

        // Diff commands
        const diff = diffCommands(existingPayloads, commandPayloads);
        logDiff(diff, `guild:${guildId}`);

        // Only register if there are changes
        if (!diff.hasChanges) {
            logger.info(`Guild commands already up-to-date`, {
                scope: "events",
                event: "ready",
                guildId,
                total: diff.summary.total,
                icon: "✓"
            });
            return existingCommands;
        }

        // Register commands
        const result = await guild.commands.set(commandPayloads);

        logger.info(`Registered ${result.size} guild command(s)`, {
            scope: "events",
            event: "ready",
            guildId,
            icon: "🛠️",
            changes: diff.summary.changed
        });

        return result;

    } catch (error) {
        logger.error(`Failed to register guild commands`, {
            scope: "events",
            event: "ready",
            guildId,
            error: error.message
        });
        return null;
    }
}

/**
 * Register global commands
 * @param {Client} client - Discord client
 * @param {Array} commandPayloads - Command payloads to register
 * @returns {Promise<Collection>}
 */
async function registerGlobalCommands(client, commandPayloads) {
    try {
        // Fetch existing global commands
        const existingCommands = await client.application.commands.fetch();
        const existingPayloads = existingCommands.map(cmd => cmd.toJSON());

        // Diff commands
        const diff = diffCommands(existingPayloads, commandPayloads);
        logDiff(diff, "global");

        // Only register if there are changes
        if (!diff.hasChanges) {
            logger.info(`Global commands already up-to-date`, {
                scope: "events",
                event: "ready",
                total: diff.summary.total,
                icon: "✓"
            });
            return existingCommands;
        }

        // Register commands
        const result = await client.application.commands.set(commandPayloads);

        logger.info(`Registered ${result.size} global command(s)`, {
            scope: "events",
            event: "ready",
            icon: "🛠️",
            changes: diff.summary.changed
        });

        return result;

    } catch (error) {
        logger.error("Failed to register global commands", {
            scope: "events",
            event: "ready",
            error: error.message
        });
        throw error;
    }
}

async function cleanupLegacyGuildCommands(client, validCommandNames) {
    const desired = new Set(validCommandNames);

    for (const guild of client.guilds.cache.values()) {
        try {
            const guildCommands = await guild.commands.fetch();
            const stale = guildCommands.filter(cmd => !desired.has(cmd.name));

            if (stale.size < 1) continue;

            logger.info(`Removing ${stale.size} legacy guild command(s) from ${guild.name}`, {
                scope: "events",
                event: "ready",
                guildId: guild.id,
                icon: "🧹",
                legacy: stale.map(cmd => cmd.name)
            });

            for (const command of stale.values()) {
                await guild.commands.delete(command.id).catch(error => {
                    logger.error("Failed to delete legacy guild command", {
                        scope: "events",
                        event: "ready",
                        guildId: guild.id,
                        command: command.name,
                        error: error.message
                    });
                });
            }
        } catch (error) {
            logger.error("Unable to fetch guild commands for cleanup", {
                scope: "events",
                event: "ready",
                guildId: guild.id,
                error: error.message
            });
        }
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

    try {
        // Update bot username if needed
        const desiredUsername = process.env.BOT_DISPLAY_NAME || "Chipsy";
        if (client?.user && client.user.username !== desiredUsername) {
            await client.user.setUsername(desiredUsername);
            logger.debug(`Updated bot username to ${desiredUsername}`, {
                scope: "events",
                event: "ready",
                icon: "📝"
            });
        }

        // Get all command payloads
        const slashCommands = client.commandRouter.getSlashCommandPayloads();

        logger.debug(`Preparing to register ${slashCommands.length} commands`, {
            scope: "events",
            event: "ready",
            commands: slashCommands.map(c => c.name)
        });

        // Register commands based on environment
        const testGuildId = config.discord.testGuildId;

        if (testGuildId) {
            // Development mode: Register to test guild first (instant updates)
            logger.info(`Test guild configured - registering commands there first`, {
                scope: "events",
                event: "ready",
                guildId: testGuildId,
                icon: "🧪"
            });

            await registerGuildCommands(client, testGuildId, slashCommands);

            // Also register globally for other guilds
            logger.debug(`Registering global commands as well`, {
                scope: "events",
                event: "ready"
            });

            await registerGlobalCommands(client, slashCommands);

            logger.info(`✓ Commands registered both in test guild (instant) and globally`, {
                scope: "events",
                event: "ready",
                icon: "✅"
            });

        } else {
            // Production mode: Only global registration
            logger.info(`No test guild configured - using global registration only`, {
                scope: "events",
                event: "ready",
                icon: "🌍"
            });

            await registerGlobalCommands(client, slashCommands);
        }

        await cleanupLegacyGuildCommands(client, slashCommands.map(cmd => cmd.name));

    } catch (err) {
        logger.error("Failed to complete ready event setup", {
            scope: "events",
            event: "ready",
            message: err?.message ?? String(err),
            stack: err?.stack
        });
    }
};
