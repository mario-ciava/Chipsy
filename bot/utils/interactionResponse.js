const { MessageFlags } = require("discord.js")

const normalizeInteractionPayload = (payload = {}) => {
    if (!payload || typeof payload !== "object") return payload

    const next = { ...payload }

    if (Object.prototype.hasOwnProperty.call(next, "ephemeral")) {
        if (next.ephemeral === true && next.flags === undefined) {
            next.flags = MessageFlags.Ephemeral
        }
        delete next.ephemeral
    }

    if (next.fetchReply === true && next.withResponse === undefined) {
        next.withResponse = true
    }

    return next
}

const readFlagValue = (flags) => {
    if (typeof flags === "number" || typeof flags === "bigint") {
        return Number(flags)
    }
    if (flags && (typeof flags.bitfield === "number" || typeof flags.bitfield === "bigint")) {
        return Number(flags.bitfield)
    }
    return null
}

const stripDeferredEphemeralFlag = (payload) => {
    if (!payload || typeof payload !== "object") return payload
    const bitfield = readFlagValue(payload.flags)
    const ephemeralBit = Number(MessageFlags.Ephemeral ?? (1 << 6))
    if (bitfield === null || (bitfield & ephemeralBit) === 0) return payload

    const next = { ...payload }
    const remaining = bitfield & ~ephemeralBit
    if (remaining === 0) delete next.flags
    else next.flags = remaining
    return next
}

const sendInteractionResponse = async(interaction, payload = {}, options = {}) => {
    if (!interaction?.reply) {
        throw new TypeError("sendInteractionResponse requires a Discord interaction")
    }

    const normalized = normalizeInteractionPayload(payload)
    const editReply = () => interaction.editReply(stripDeferredEphemeralFlag(normalized))

    if (options.forceEdit === true || (interaction.deferred && !interaction.replied)) {
        return editReply()
    }

    if (!interaction.replied) {
        return interaction.reply(normalized)
    }

    if (options.allowFollowUp === false) {
        return editReply()
    }

    return interaction.followUp(normalized)
}

module.exports = {
    normalizeInteractionPayload,
    stripDeferredEphemeralFlag,
    sendInteractionResponse
}
