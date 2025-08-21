const { Collection, ApplicationCommandOptionType, EmbedBuilder, Colors } = require("discord.js")
const logger = require("./logger")

class CommandRouter {
    constructor(client) {
        this.client = client
        this.messageCommands = new Collection()
        this.slashCommands = new Collection()
    }

    register(command) {
        const config = command.config || {}
        const name = typeof config.name === "string" ? config.name.toLowerCase() : ""

        if (!name) {
            throw new Error("Command registration failed: command name is missing or invalid.")
        }

        const handler = command.run || command.execute
        if (typeof handler !== "function") {
            throw new Error(`Command registration failed for '${config.name}': missing executable handler.`)
        }

        this.messageCommands.set(name, command)

        const aliases = Array.isArray(config.aliases) ? config.aliases : []
        for (const alias of aliases) {
            if (typeof alias !== "string") continue
            const aliasKey = alias.toLowerCase()
            if (!aliasKey || aliasKey === name) continue
            this.messageCommands.set(aliasKey, command)
        }

        const slashCommand = config.slashCommand || command.data
        const slashName = typeof slashCommand?.name === "string" ? slashCommand.name.toLowerCase() : name

        if (slashCommand && typeof slashCommand.toJSON === "function") {
            this.slashCommands.set(slashName, command)
        }
    }

    getSlashCommandPayloads() {
        const payloads = []
        const seen = new Set()
        for (const command of this.slashCommands.values()) {
            if (seen.has(command)) continue
            seen.add(command)

            const config = command.config || {}
            const data = config.slashCommand || command.data
            if (!data || typeof data.toJSON !== "function") continue

            if (config.defaultMemberPermissions !== undefined && typeof data.setDefaultMemberPermissions === "function") {
                data.setDefaultMemberPermissions(config.defaultMemberPermissions)
            }

            if (config.dmPermission !== undefined && typeof data.setDMPermission === "function") {
                data.setDMPermission(config.dmPermission)
            }

            payloads.push(data.toJSON())
        }
        return payloads
    }

    async handleMessage(message) {
        const commandName = message.command?.toLowerCase()
        if (!commandName) return

        const command = this.messageCommands.get(commandName)
        if (!command) return

        if (!message.author.data) {
            const result = await this.client.SetData(message.author)
            if (result.error) {
                if (result.error.type === "database") {
                    const embed = new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setFooter({
                            text: `${message.author.tag}, error: unable to reach the database. Please try again later.`,
                            iconURL: message.author.displayAvatarURL({ extension: "png" })
                        })
                    await message.channel?.send({ embeds: [embed] }).catch(() => null)
                }
                return
            }
            if (!result.data) return
        }

        try {
            await (command.run || command.execute)({
                type: "message",
                message,
                args: message.params,
                client: this.client
            })
        } catch (error) {
            logger.error("Failed to execute message command", {
                scope: "commandRouter",
                command: commandName,
                userId: message.author?.id,
                channelId: message.channel?.id,
                error: error.message,
                stack: error.stack
            })
        }
    }

    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return

        const command = this.slashCommands.get(interaction.commandName.toLowerCase())
        if (!command) return

        const args = this.resolveInteractionArgs(interaction)
        const messageAdapter = this.createMessageAdapter(interaction, args)

        try {
            const config = command.config || {}
            const shouldDefer = config.defer !== undefined ? config.defer : true
            const deferEphemeral = config.deferEphemeral !== undefined ? config.deferEphemeral : true
            if (shouldDefer && !interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: deferEphemeral })
            }
        } catch (error) {
            logger.error("Failed to defer reply for slash command", {
                scope: "commandRouter",
                command: interaction.commandName,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                error: error.message,
                stack: error.stack
            })
        }

        if (!messageAdapter.author.data) {
            const result = await this.client.SetData(messageAdapter.author)
            if (result.error) {
                const response = {
                    content:
                        result.error.type === "database"
                            ? "We couldn't connect to the database. Please try again later."
                            : "Unable to prepare your player profile. Please contact support.",
                    ephemeral: true
                }

                if (interaction.deferred && !interaction.replied) {
                    await interaction.followUp(response).catch(() => null)
                } else if (!interaction.replied) {
                    await interaction.reply(response).catch(() => null)
                }
                return
            }
            if (!result.data) return
        }

        try {
            await (command.run || command.execute)({
                type: "interaction",
                interaction,
                message: messageAdapter,
                args,
                client: this.client
            })
        } catch (error) {
            logger.error("Failed to execute slash command", {
                scope: "commandRouter",
                command: interaction.commandName,
                userId: interaction.user?.id,
                guildId: interaction.guild?.id,
                error: error.message,
                stack: error.stack
            })
            const response = {
                content: "An error occurred while executing this command.",
                ephemeral: true
            }

            if (interaction.deferred && !interaction.replied) {
                await interaction.followUp(response).catch(() => null)
            } else if (!interaction.replied) {
                await interaction.reply(response).catch(() => null)
            }
        } finally {
            if (interaction.deferred && !interaction.replied) {
                await interaction.deleteReply().catch(() => null)
            }
        }
    }

    resolveInteractionArgs(interaction) {
        const args = []
        const traverse = (options) => {
            for (const option of options) {
                if (
                    option.type === ApplicationCommandOptionType.Subcommand ||
                    option.type === ApplicationCommandOptionType.SubcommandGroup
                ) {
                    if (option.name) {
                        args.push(option.name)
                    }
                    if (option.options?.length) traverse(option.options)
                } else if (option.value !== undefined && option.value !== null) {
                    args.push(String(option.value))
                }
            }
        }

        traverse(interaction.options.data)
        return args
    }

    createMessageAdapter(interaction, args) {
        return {
            id: interaction.id,
            author: interaction.user,
            client: interaction.client,
            guild: interaction.guild,
            channel: interaction.channel,
            createdTimestamp: Date.now(),
            params: [...args],
            command: interaction.commandName,
            prefix: interaction.client?.config?.prefix,
            interaction
        }
    }
}

module.exports = CommandRouter
