const createCollectorStub = () => {
    const collector = {
        ended: false
    }
    collector.on = () => collector
    collector.stop = () => {
        collector.ended = true
    }
    return collector
}

const createSentMessageStub = () => ({
    createMessageComponentCollector: () => createCollectorStub()
})

const createInteractionShim = (message, { getUser } = {}) => {
    if (!message?.channel?.send) {
        throw new Error("A Discord-like message with a channel.send method is required.")
    }

    const interaction = {
        user: message.author,
        client: message.client,
        channel: message.channel,
        deferred: false,
        replied: false,
        options: {
            getUser: (...args) => (typeof getUser === "function" ? getUser(...args) : null)
        },
        reply: async(payload = {}) => {
            interaction.replied = true
            await message.channel.send(payload)
            return createSentMessageStub()
        },
        editReply: async(payload = {}) => {
            interaction.replied = true
            await message.channel.send(payload)
            return createSentMessageStub()
        },
        followUp: async(payload = {}) => {
            await message.channel.send(payload)
            return createSentMessageStub()
        }
    }

    return interaction
}

module.exports = createInteractionShim
