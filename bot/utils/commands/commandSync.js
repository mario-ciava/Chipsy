const { diffCommands, logDiff } = require("./commandDiffer")
const logger = require("../../shared/logger")

const createCommandSync = ({ client, config, logger: injectedLogger = logger }) => {
    if (!client) {
        throw new Error("Command sync service requires a Discord client")
    }

    const log = injectedLogger

    const registerGuildCommands = async(guildId, commandPayloads) => {
        try {
            const guild = client.guilds.cache.get(guildId)
            if (!guild) {
                log.warn(`Guild ${guildId} not found - bot is likely not in that guild`, {
                    scope: "commandSync",
                    target: guildId
                })
                return null
            }

            const existingCommands = await guild.commands.fetch()
            const existingPayloads = existingCommands.map(cmd => cmd.toJSON())

            const diff = diffCommands(existingPayloads, commandPayloads)
            logDiff(diff, `guild:${guildId}`)

            if (!diff.hasChanges) {
                log.info("Guild commands already up-to-date", {
                    scope: "commandSync",
                    target: guildId,
                    total: diff.summary.total,
                    icon: "✓"
                })
                return existingCommands
            }

            const result = await guild.commands.set(commandPayloads)
            log.info(`Registered ${result.size} guild command(s)`, {
                scope: "commandSync",
                target: guildId,
                icon: "🛠️",
                changes: diff.summary.changed
            })

            return result
        } catch (error) {
            log.error("Failed to register guild commands", {
                scope: "commandSync",
                target: guildId,
                error: error.message
            })
            return null
        }
    }

    const registerGlobalCommands = async(commandPayloads) => {
        try {
            const application = client.application
            if (!application?.commands) {
                throw new Error("Discord application commands unavailable")
            }

            const existingCommands = await application.commands.fetch()
            const existingPayloads = existingCommands.map(cmd => cmd.toJSON())

            const diff = diffCommands(existingPayloads, commandPayloads)
            logDiff(diff, "global")

            if (!diff.hasChanges) {
                log.info("Global commands already up-to-date", {
                    scope: "commandSync",
                    target: "global",
                    total: diff.summary.total,
                    icon: "✓"
                })
                return existingCommands
            }

            const result = await application.commands.set(commandPayloads)
            log.info(`Registered ${result.size} global command(s)`, {
                scope: "commandSync",
                target: "global",
                icon: "🛠️",
                changes: diff.summary.changed
            })

            return result
        } catch (error) {
            log.error("Failed to register global commands", {
                scope: "commandSync",
                target: "global",
                error: error.message
            })
            throw error
        }
    }

    const cleanupLegacyGuildCommands = async(validCommandNames, { guildIds = [] } = {}) => {
        if (!guildIds.length) {
            log.debug("Skipping legacy guild command cleanup - no guilds provided", {
                scope: "commandSync"
            })
            return
        }

        const desired = new Set(validCommandNames)

        for (const guildId of guildIds) {
            const guild = client.guilds.cache.get(guildId)
            if (!guild) {
                log.warn(`Skipping cleanup for unknown guild ${guildId}`, {
                    scope: "commandSync"
                })
                continue
            }

            try {
                const guildCommands = await guild.commands.fetch()
                const stale = guildCommands.filter(cmd => !desired.has(cmd.name))

                if (!stale.size) continue

                log.info(`Removing ${stale.size} legacy guild command(s) from ${guild.name}`, {
                    scope: "commandSync",
                    target: guild.id,
                    icon: "🧹",
                    legacy: stale.map(cmd => cmd.name)
                })

                for (const command of stale.values()) {
                    // eslint-disable-next-line no-await-in-loop
                    await guild.commands.delete(command.id).catch(error => {
                        log.error("Failed to delete legacy guild command", {
                            scope: "commandSync",
                            target: guild.id,
                            command: command.name,
                            error: error.message
                        })
                    })
                }
            } catch (error) {
                log.error("Unable to fetch guild commands for cleanup", {
                    scope: "commandSync",
                    target: guildId,
                    error: error.message
                })
            }
        }
    }

    const ensureClientReady = () => {
        if (typeof client.isReady === "function" && client.isReady()) {
            return true
        }
        throw new Error("Discord client not ready yet - cannot sync commands")
    }

    const synchronize = async({ reason = "manual", payloads } = {}) => {
        ensureClientReady()

        const slashCommands = payloads || client.commandRouter.getSlashCommandPayloads()
        log.debug(`Preparing to register ${slashCommands.length} commands`, {
            scope: "commandSync",
            commands: slashCommands.map(c => c.name),
            reason
        })

        const testGuildId = config.discord.testGuildId
        const isProduction = process.env.NODE_ENV === "production"

        if (isProduction) {
            // Production: test guild gets local commands, others get global
            if (testGuildId) {
                log.info("Registering local commands to test guild", {
                    scope: "commandSync",
                    target: testGuildId,
                    reason,
                    icon: "🧪"
                })
                await registerGuildCommands(testGuildId, slashCommands)
            }

            log.info("Registering global commands", {
                scope: "commandSync",
                reason,
                icon: "🌍"
            })
            await registerGlobalCommands(slashCommands)
        } else if (testGuildId) {
            // Development: test guild only (instant updates)
            log.info("Development mode - registering to test guild only", {
                scope: "commandSync",
                target: testGuildId,
                reason,
                icon: "🧪"
            })
            await registerGuildCommands(testGuildId, slashCommands)
        } else {
            // Development without test guild: global only
            log.info("No test guild configured - using global registration", {
                scope: "commandSync",
                reason,
                icon: "🌍"
            })
            await registerGlobalCommands(slashCommands)
        }

        // Cleanup stale commands in test guild
        if (testGuildId) {
            setImmediate(() => {
                cleanupLegacyGuildCommands(slashCommands.map(cmd => cmd.name), { guildIds: [testGuildId] })
                    .catch(error => {
                        log.error("Legacy guild command cleanup failed", {
                            scope: "commandSync",
                            error: error?.message ?? String(error)
                        })
                    })
            })
        }

        return {
            commands: slashCommands.length,
            reason
        }
    }

    return {
        synchronize,
        registerGuildCommands,
        registerGlobalCommands,
        cleanupLegacyGuildCommands
    }
}

module.exports = createCommandSync
