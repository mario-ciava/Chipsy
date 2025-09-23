const { Collection, MessageFlags } = require("discord.js")
const logger = require("./logger")
const { logAndSuppress } = logger
const { sendInteractionResponse } = require("./interactionResponse")

const isAutocompleteInteraction = (interaction) => (
    typeof interaction?.isAutocomplete === "function" && interaction.isAutocomplete()
)

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
        try {
            await command.execute(interaction, this.client)
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
        if (!interaction?.user || interaction.user.data || typeof this.client?.SetData !== "function") {
            return { ok: true, data: interaction?.user?.data }
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
}

module.exports = CommandRouter
