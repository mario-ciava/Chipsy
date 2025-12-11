const { Collection, MessageFlags, EmbedBuilder, Colors } = require("discord.js")
const config = require("../../../config")
const logger = require("../../../shared/logger")
const { logAndSuppress } = logger
const { sendInteractionResponse } = require("../interactionResponse")
const { getAccessDeniedMessage, buildGuildContext } = require("../interactionAccess")
const { buildInteractionLogContext } = require("../interactionContext")

const ROUTER_SCOPE = "commandRouter"
const COMMAND_TELEMETRY_ENABLED = config?.logging?.commandTelemetry?.enabled !== false

const ensureLoggerFn = (level) => {
    if (typeof logger[level] === "function") {
        return logger[level]
    }
    return logger.info
}

/**
 * Simple, clean command router for slash commands only.
 * No abstractions, no adapters, just Discord.js native API.
 */
class CommandRouter {
    constructor(client) {
        this.client = client
        this.commands = new Collection()
    }

    buildLogMeta(interaction, meta = {}) {
        return buildInteractionLogContext(interaction, {
            scope: ROUTER_SCOPE,
            ...meta
        })
    }

    log(level, message, interaction, meta = {}) {
        const fn = ensureLoggerFn(level)
        fn(message, this.buildLogMeta(interaction, meta))
    }

    /**
     * Register a command.
     * @param {Object} command - Command object with config and execute function
     */
    register(command, { replace = true } = {}) {
        const config = command.config
        if (!config?.name) {
            throw new Error("Command registration failed: missing name")
        }
        if (!config?.slashCommand?.toJSON) {
            throw new Error(`Command '${config.name}' missing valid SlashCommandBuilder`)
        }
        if (typeof command.execute !== "function") {
            throw new Error(`Command '${config.name}' missing execute function`)
        }

        const key = config.name.toLowerCase()
        const existing = this.commands.get(key)
        if (existing && !replace) {
            throw new Error(`Command '${config.name}' already registered`)
        }

        this.commands.set(key, command)
        return command
    }

    unregister(name) {
        if (!name) return false
        const key = typeof name === "string" ? name.toLowerCase() : name
        if (!key) return false
        return this.commands.delete(key)
    }

    /**
     * Get all slash command payloads for Discord API registration.
     */
    getSlashCommandPayloads() {
        return Array.from(this.commands.values()).map(command => {
            const { config } = command
            const builder = config.slashCommand

            if (config.defaultMemberPermissions !== undefined) {
                builder.setDefaultMemberPermissions(config.defaultMemberPermissions)
            }
            if (config.dmPermission !== undefined) {
                builder.setDMPermission(config.dmPermission)
            }

            return builder.toJSON()
        })
    }

    /**
     * Handle slash command interaction.
     * Clean, simple, no abstractions.
     */
    async handleInteraction(interaction) {
        if (typeof interaction?.isAutocomplete === "function" && interaction.isAutocomplete()) {
            return this.handleAutocomplete(interaction)
        }

        if (!interaction.isChatInputCommand()) return

        const commandKey = interaction.commandName?.toLowerCase()
        const command = this.commands.get(commandKey)
        if (!command) {
            this.log("warn", "command.notRegistered", interaction, { commandKey })
            return
        }

        const { config } = command
        this.log("info", "command.accepted", interaction, {
            commandKey,
            autoDefer: config.defer ?? true,
            deferEphemeral: config.deferEphemeral ?? true
        })

        const accessResult = await this.ensureBotAccess(interaction)
        if (!accessResult.allowed) {
            this.log("warn", "command.accessDenied", interaction, {
                reason: accessResult.reason,
                policyId: accessResult.policy?.id ?? null
            })
            const denialMessage = getAccessDeniedMessage(accessResult.reason)
            if (denialMessage) {
                await this.replyOrFollowUp(interaction, {
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(denialMessage)],
                    flags: MessageFlags.Ephemeral
                })
            }
            return
        }

        // Auto-defer if configured
        let didDefer = false
        try {
            const shouldDefer = config.defer ?? true
            const deferEphemeral = config.deferEphemeral ?? true

            if (shouldDefer && !interaction.deferred && !interaction.replied) {
                await interaction.deferReply({
                    flags: deferEphemeral ? MessageFlags.Ephemeral : undefined
                })
                didDefer = true
                this.log("debug", "command.deferred", interaction, {
                    deferredEphemeral: deferEphemeral
                })
            }
        } catch (error) {
            this.log("error", "command.deferFailed", interaction, {
                errorMessage: error.message,
                stack: error.stack
            })
        }

        if (!config.skipUserData) {
            const userResult = await this.ensureUserData(interaction)
            if (!userResult.ok) {
                if (userResult.error?.type === "bot-user") {
                    this.log("debug", "command.ignoredBotUser", interaction)
                    return
                }
                this.log("warn", "command.userWarmupFailed", interaction, {
                    errorType: userResult.error?.type,
                    errorMessage: userResult.error?.message
                })
                const content = userResult.error?.type === "database"
                    ? "❌ Database connection failed. Please try again later."
                    : "❌ Failed to load your profile. Please contact support."

                await this.replyOrFollowUp(interaction, {
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(content)],
                    flags: MessageFlags.Ephemeral
                })
                return
            }
        }

        // Execute command
        const executionStartedAt = Date.now()
        const runId = `${interaction.id || "interaction"}:${executionStartedAt}`
        this.log("info", "command.execution.start", interaction, {
            runId,
            wasDeferred: didDefer
        })

        try {
            await command.execute(interaction, this.client)
            const durationMs = Date.now() - executionStartedAt
            this.log("info", "command.execution.success", interaction, {
                runId,
                durationMs
            })
            this.logCommandUsage(interaction, {
                status: "success",
                durationMs
            })
        } catch (error) {
            const durationMs = Date.now() - executionStartedAt
            this.log("error", "command.execution.failed", interaction, {
                runId,
                durationMs,
                errorMessage: error.message,
                stack: error.stack
            })
            await this.replyOrFollowUp(interaction, {
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ An unexpected error occurred. Please try again later.")],
                flags: MessageFlags.Ephemeral
            })

            this.logCommandUsage(interaction, {
                status: "error",
                durationMs,
                error
            })
        }
    }

    /**
     * Reply or follow-up depending on interaction state.
     */
    async replyOrFollowUp(interaction, payload = {}) {
        try {
            return await sendInteractionResponse(interaction, payload)
        } catch (error) {
            this.log("warn", "command.replyFailed", interaction, {
                errorMessage: error.message
            })
        }
    }

    async handleAutocomplete(interaction) {
        const command = this.commands.get(interaction.commandName.toLowerCase())
        if (!command) {
            this.log("warn", "autocomplete.missingCommand", interaction)
            await interaction.respond([]).catch(
                logAndSuppress("Failed to send empty autocomplete response - command missing", {
                    scope: "commandRouter",
                    command: interaction.commandName
                })
            )
            return
        }

        if (typeof command.autocomplete !== "function") {
            this.log("warn", "autocomplete.handlerMissing", interaction)
            await interaction.respond([]).catch(
                logAndSuppress("Failed to send empty autocomplete response - handler missing", {
                    scope: "commandRouter",
                    command: interaction.commandName
                })
            )
            return
        }

        const accessResult = await this.ensureBotAccess(interaction)
        if (!accessResult.allowed) {
            this.log("info", "autocomplete.accessDenied", interaction, {
                reason: accessResult.reason
            })
            await interaction.respond([]).catch(
                logAndSuppress("Failed to send access denied autocomplete response", {
                    scope: "commandRouter",
                    command: interaction.commandName
                })
            )
            return
        }

        const userResult = await this.ensureUserData(interaction)
        if (!userResult.ok) {
            this.log("warn", "autocomplete.userWarmupFailed", interaction, {
                errorType: userResult.error?.type,
                errorMessage: userResult.error?.message
            })
            await interaction.respond([]).catch(
                logAndSuppress("Failed to send autocomplete failure response", {
                    scope: "commandRouter",
                    command: interaction.commandName
                })
            )
            return
        }

        try {
            const result = await command.autocomplete(interaction, this.client)
            if (interaction.responded) return

            const choices = Array.isArray(result) ? result : []
            await interaction.respond(choices.slice(0, 25))
            this.log("debug", "autocomplete.responded", interaction, {
                choiceCount: choices.length
            })
        } catch (error) {
            this.log("warn", "autocomplete.handlerFailed", interaction, {
                errorMessage: error.message,
                stack: error.stack
            })
            if (!interaction.responded) {
                await interaction.respond([]).catch(
                    logAndSuppress("Failed to send fallback autocomplete response", {
                        scope: "commandRouter",
                        command: interaction.commandName
                    })
                )
            }
        }
    }

    async ensureUserData(interaction) {
        if (!interaction?.user) {
            return { ok: false, error: { type: "missing-user" } }
        }
        if (interaction.user.bot || interaction.user.system) {
            return { ok: false, error: { type: "bot-user" } }
        }
        if (interaction.user.data || typeof this.client?.SetData !== "function") {
            return { ok: true, data: interaction.user.data }
        }

        try {
            const result = await this.client.SetData(interaction.user)
            if (result?.error || !result?.data) {
                return { ok: false, error: result?.error || { type: "missing-data" } }
            }
            interaction.user.data = result.data
            return { ok: true, data: result.data }
        } catch (error) {
            return {
                ok: false,
                error: {
                    type: "unexpected",
                    message: error?.message ?? String(error)
                }
            }
        }
    }

    async ensureBotAccess(interaction) {
        if (!interaction?.user?.id) {
            return { allowed: false, reason: "missing-user" }
        }
        const accessControl = this.client?.accessControl
        if (!accessControl || typeof accessControl.evaluateBotAccess !== "function") {
            return { allowed: true }
        }
        try {
            const result = await accessControl.evaluateBotAccess(
                interaction.user.id,
                buildGuildContext(interaction)
            )
            if (!result || result.allowed !== false) {
                return { allowed: true }
            }
            return {
                allowed: false,
                reason: result.reason || "access-denied",
                record: result.record,
                policy: result.policy
            }
        } catch (error) {
            this.log("error", "command.accessEvaluationFailed", interaction, {
                errorMessage: error.message,
                stack: error.stack
            })
            return { allowed: false, reason: "policy-error" }
        }
    }

    logCommandUsage(interaction, { status = "success", durationMs = null, error = null } = {}) {
        if (!COMMAND_TELEMETRY_ENABLED) {
            return
        }
        const usageLogger = this.client?.commandLogger
        if (!usageLogger || typeof usageLogger.recordInteraction !== "function" || !interaction) {
            return
        }

        const payload = buildInteractionLogContext(interaction, {
            status,
            durationMs,
            errorMessage: error?.message ?? null
        })

        this.log("debug", "command.telemetry.enqueue", interaction, {
            status,
            durationMs,
            capturedError: Boolean(error)
        })

        Promise.resolve(usageLogger.recordInteraction(payload)).catch((logError) => {
            this.log("warn", "command.telemetry.failed", interaction, {
                errorMessage: logError?.message
            })
        })
    }
}

module.exports = CommandRouter
