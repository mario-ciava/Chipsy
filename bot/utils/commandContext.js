const { EmbedBuilder, Colors } = require("discord.js")
const {
    normalizeInteractionPayload,
    stripDeferredEphemeralFlag
} = require("./interactionResponse")

class CommandUserError extends Error {
    constructor(message, options = {}) {
        super(message)
        this.name = "CommandUserError"
        this.userMessage = message
        this.ephemeral = options.ephemeral
        this.embed = options.embed
        this.payload = options.payload
        this.log = options.log ?? true
    }
}

/**
 * Builds command context for slash commands only.
 * Provides clean abstraction over Discord.js interaction API.
 */
const buildCommandContext = ({ commandName, message, interaction, client, logger }) => {
    if (!interaction) {
        throw new Error(`Command '${commandName}' requires an interaction (slash commands only).`)
    }

    const author = interaction.user
    const channel = interaction.channel
    const guild = interaction.guild
    const responded = { value: false }

    /**
     * Reply to the interaction.
     * Handles deferred/replied states automatically.
     */
    const reply = async(payload = {}) => {
        let response
        const normalizedPayload = normalizeInteractionPayload(payload)

        if (interaction.deferred && !interaction.replied) {
            response = await interaction.editReply(stripDeferredEphemeralFlag(normalizedPayload))
        } else if (!interaction.replied) {
            response = await interaction.reply(normalizedPayload)
        } else {
            response = await interaction.followUp(normalizedPayload)
        }

        responded.value = true
        return response
    }

    /**
     * Send a follow-up message.
     */
    const followUp = async(payload = {}) => {
        const normalizedPayload = normalizeInteractionPayload(payload)
        responded.value = true
        return interaction.followUp(normalizedPayload)
    }

    /**
     * Send a message to the channel (bypasses interaction).
     * Use this for game messages that shouldn't be ephemeral.
     */
    const send = async(payload = {}) => {
        if (!channel || typeof channel.send !== "function") {
            throw new Error(`Command '${commandName}' could not resolve a sendable channel.`)
        }
        return channel.send(payload)
    }

    /**
     * Edit the initial reply.
     */
    const editReply = async(payload = {}) => {
        const normalizedPayload = normalizeInteractionPayload(payload)
        responded.value = true
        return interaction.editReply(stripDeferredEphemeralFlag(normalizedPayload))
    }

    const safeInvoke = async(fn, ...params) => {
        try {
            return await fn(...params)
        } catch (error) {
            logger?.warn?.("Failed to deliver command response", {
                scope: "commands",
                command: commandName,
                userId: author?.id,
                channelId: channel?.id,
                error: error.message
            })
            return null
        }
    }

    const createErrorEmbed = (text) =>
        new EmbedBuilder()
            .setColor(Colors.Red)
            .setDescription(text.startsWith("❌") ? text : `❌ ${text}`)

    /**
     * Reply with an error message.
     * Errors are ephemeral by default.
     */
    const replyError = async(text, options = {}) => {
        const { ephemeral = true, embed, payload } = options

        if (payload) {
            const constructedPayload = {
                ...payload,
                ...(ephemeral ? { ephemeral: true } : null)
            }
            return safeInvoke(reply, constructedPayload)
        }

        const errorEmbed = embed ?? createErrorEmbed(text)
        const responsePayload = {
            embeds: [errorEmbed],
            ...(ephemeral ? { ephemeral: true } : null)
        }
        return safeInvoke(reply, responsePayload)
    }

    const fail = (text, options = {}) => {
        throw new CommandUserError(text, options)
    }

    return {
        commandName,
        interaction,
        message, // Message adapter with options object
        client,
        author,
        channel,
        guild,
        replied: () => responded.value,
        reply,
        followUp,
        send,
        editReply,
        safeInvoke,
        replyError,
        createErrorEmbed,
        fail
    }
}

module.exports = {
    buildCommandContext,
    CommandUserError
}
