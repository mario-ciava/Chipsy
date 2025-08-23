const { EmbedBuilder, Colors } = require("discord.js")

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

const buildCommandContext = ({ commandName, message, interaction, client, args, logger }) => {
    const author = message?.author ?? interaction?.user ?? null
    const channel = message?.channel ?? interaction?.channel ?? null
    const guild = channel?.guild ?? interaction?.guild ?? null
    const responded = { value: false }

    const resolveSendableChannel = () => {
        if (channel && typeof channel.send === "function") return channel
        throw new Error(`Command '${commandName}' could not resolve a sendable channel.`)
    }

    const reply = async(payload = {}) => {
        if (interaction) {
            let response
            if (interaction.deferred && !interaction.replied) {
                response = await interaction.editReply(payload)
            } else if (!interaction.replied) {
                response = await interaction.reply(payload)
            } else {
                response = await interaction.followUp(payload)
            }
            responded.value = true
            return response
        }

        const targetChannel = resolveSendableChannel()
        const response = await targetChannel.send(payload)
        responded.value = true
        return response
    }

    const followUp = async(payload = {}) => {
        if (interaction) {
            responded.value = true
            return interaction.followUp(payload)
        }

        const targetChannel = resolveSendableChannel()
        responded.value = true
        return targetChannel.send(payload)
    }

    const send = async(payload = {}) => {
        const targetChannel = resolveSendableChannel()
        return targetChannel.send(payload)
    }

    const editReply = async(payload = {}) => {
        if (!interaction) {
            throw new Error(`Command '${commandName}' attempted to edit a reply outside of an interaction context.`)
        }
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

    const replyError = async(text, options = {}) => {
        const { ephemeral, embed, payload } = options

        if (payload) {
            const constructedPayload = { ...payload }
            if (interaction) {
                constructedPayload.ephemeral = ephemeral ?? constructedPayload.ephemeral ?? true
            }
            return safeInvoke(reply, constructedPayload)
        }

        const errorEmbed = embed ?? createErrorEmbed(text)
        const responsePayload = { embeds: [errorEmbed] }
        if (interaction) {
            responsePayload.ephemeral = ephemeral ?? true
        }
        return safeInvoke(reply, responsePayload)
    }

    const fail = (text, options = {}) => {
        throw new CommandUserError(text, options)
    }

    return {
        commandName,
        interaction,
        message,
        client,
        args: Array.isArray(args) ? args : [],
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
