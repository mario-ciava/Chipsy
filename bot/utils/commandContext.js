const { EmbedBuilder, Colors, MessageFlags } = require("discord.js")

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

const normalizeInteractionPayload = (payload = {}) => {
    if (!payload || typeof payload !== "object") return payload

    const next = { ...payload }

    if (Object.prototype.hasOwnProperty.call(next, "ephemeral")) {
        const ephemeral = next.ephemeral
        delete next.ephemeral

        if (ephemeral === true && next.flags === undefined) {
            next.flags = MessageFlags.Ephemeral
        }
    }

    if (Object.prototype.hasOwnProperty.call(next, "fetchReply")) {
        const fetchReply = next.fetchReply
        delete next.fetchReply
        if (fetchReply === true && next.withResponse === undefined) {
            next.withResponse = true
        }
    }

    return next
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
            response = await interaction.editReply(normalizedPayload)
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
        responded.value = true
        return interaction.editReply(payload)
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
            const constructedPayload = { ...payload }
            if (ephemeral) {
                constructedPayload.flags = MessageFlags.Ephemeral
            }
            return safeInvoke(reply, constructedPayload)
        }

        const errorEmbed = embed ?? createErrorEmbed(text)
        const responsePayload = { embeds: [errorEmbed] }
        if (ephemeral) {
            responsePayload.flags = MessageFlags.Ephemeral
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
