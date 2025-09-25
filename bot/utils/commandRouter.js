const { Collection, MessageFlags } = require("discord.js")
const logger = require("./logger")
const { logAndSuppress } = logger
const { sendInteractionResponse } = require("./interactionResponse")

const isAutocompleteInteraction = (interaction) => (
    typeof interaction?.isAutocomplete === "function" && interaction.isAutocomplete()
)

const resolveUserTag = (user) => {
    if (!user) return null
    if (user.tag) return user.tag
    if (user.globalName && user.discriminator === "0") {
        return user.globalName
    }
    if (user.username && user.discriminator) {
        return `${user.username}#${user.discriminator}`
    }
    return user.username || null
}

const resolveCommandPath = (interaction) => {
    if (!interaction?.commandName) return null
    const segments = [interaction.commandName]

    try {
        if (typeof interaction.options?.getSubcommandGroup === "function") {
            const group = interaction.options.getSubcommandGroup(false)
            if (group) {
                segments.push(group)
            }
        }
    } catch (error) {
        // No-op: method throws if group is not present and required flag omitted
    }

    try {
        if (typeof interaction.options?.getSubcommand === "function") {
            const sub = interaction.options.getSubcommand(false)
            if (sub && sub !== segments[segments.length - 1]) {
                segments.push(sub)
            }
        }
    } catch (error) {
        // Same as above
    }

    return segments.filter(Boolean).join(" ")
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
        if (isAutocompleteInteraction(interaction)) {
            return this.handleAutocomplete(interaction)
        }

        if (!interaction.isChatInputCommand()) return

        const command = this.commands.get(interaction.commandName.toLowerCase())
        if (!command) return

        const { config } = command

        const accessResult = await this.ensureBotAccess(interaction)
        if (!accessResult.allowed) {
            const denialMessage = this.getAccessDeniedMessage(accessResult.reason)
            if (denialMessage) {
                await this.replyOrFollowUp(interaction, {
                    content: denialMessage,
                    flags: MessageFlags.Ephemeral
                })
            }
            return
        }

        // Auto-defer if configured
        try {
            const shouldDefer = config.defer ?? true
            const deferEphemeral = config.deferEphemeral ?? true

            if (shouldDefer && !interaction.deferred && !interaction.replied) {
                await interaction.deferReply({
                    flags: deferEphemeral ? MessageFlags.Ephemeral : undefined
                })
            }
        } catch (error) {
            logger.error("Failed to defer interaction", {
                scope: "commandRouter",
                command: interaction.commandName,
                error: error.message
            })
        }

        const userResult = await this.ensureUserData(interaction)
        if (!userResult.ok) {
            if (userResult.error?.type === "bot-user") {
                return
            }
            const content = userResult.error?.type === "database"
                ? "❌ Database connection failed. Please try again later."
                : "❌ Failed to load your profile. Please contact support."

            await this.replyOrFollowUp(interaction, {
                content,
                flags: MessageFlags.Ephemeral
            })
            return
        }

        // Execute command
        const executionStartedAt = Date.now()

        try {
            await command.execute(interaction, this.client)
            this.logCommandUsage(interaction, {
                status: "success",
                durationMs: Date.now() - executionStartedAt
            })
        } catch (error) {
            logger.error("Command execution failed", {
                scope: "commandRouter",
                command: interaction.commandName,
                userId: interaction.user.id,
                error: error.message,
                stack: error.stack
            })

            await this.replyOrFollowUp(interaction, {
                content: "❌ An unexpected error occurred. Please try again later.",
                flags: MessageFlags.Ephemeral
            })

            this.logCommandUsage(interaction, {
                status: "error",
                durationMs: Date.now() - executionStartedAt,
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
            logger.warn("Failed to send interaction response", {
                scope: "commandRouter",
                error: error.message
            })
        }
    }

    async handleAutocomplete(interaction) {
        const command = this.commands.get(interaction.commandName.toLowerCase())
        if (!command) {
            await interaction.respond([]).catch(
                logAndSuppress("Failed to send empty autocomplete response - command missing", {
                    scope: "commandRouter",
                    command: interaction.commandName
                })
            )
            return
        }

        if (typeof command.autocomplete !== "function") {
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
            logger.warn("Skipping autocomplete - failed to warm up user data", {
                scope: "commandRouter",
                command: interaction.commandName,
                error: userResult.error?.message,
                type: userResult.error?.type
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
        } catch (error) {
            logger.warn("Autocomplete handler failed", {
                scope: "commandRouter",
                command: interaction.commandName,
                error: error.message
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
            const result = await accessControl.evaluateBotAccess(interaction.user.id)
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
            logger.error("Failed to evaluate access policy", {
                scope: "commandRouter",
                userId: interaction.user.id,
                error: error.message
            })
            return { allowed: false, reason: "policy-error" }
        }
    }

    getAccessDeniedMessage(reason) {
        if (reason === "bot-user") {
            return null
        }
        if (reason === "blacklisted") {
            return "🚫 You are blacklisted and cannot use Chipsy."
        }
        if (reason === "whitelist") {
            return "⚠️ Chipsy is currently restricted to the whitelist. Please contact an admin to gain access."
        }
        if (reason === "missing-user") {
            return "❌ Unable to resolve your Discord account. Please try again."
        }
        if (reason === "policy-error" || reason === "access-denied") {
            return "❌ Unable to verify your access right now. Please try again later."
        }
        return null
    }

    logCommandUsage(interaction, { status = "success", durationMs = null, error = null } = {}) {
        const usageLogger = this.client?.commandLogger
        if (!usageLogger || typeof usageLogger.recordInteraction !== "function" || !interaction) {
            return
        }

        const payload = {
            commandPath: resolveCommandPath(interaction),
            userTag: resolveUserTag(interaction.user),
            userId: interaction.user?.id ?? null,
            guildId: interaction.guildId ?? interaction.guild?.id ?? null,
            guildName: interaction.guild?.name ?? null,
            channelId: interaction.channelId ?? interaction.channel?.id ?? null,
            channelName: interaction.channel?.name ?? null,
            status,
            durationMs,
            errorMessage: error?.message ?? null
        }

        Promise.resolve(usageLogger.recordInteraction(payload)).catch((logError) => {
            logger.warn("Failed to record command usage", {
                scope: "commandRouter",
                command: interaction.commandName,
                error: logError?.message
            })
        })
    }
}

module.exports = CommandRouter
