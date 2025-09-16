const { MessageFlags } = require("discord.js")

/**
 * Normalize the payload for an interaction response.
 * Supports ergonomic aliases like `ephemeral` and `fetchReply`.
 * @param {Object} payload
 * @returns {Object}
 */
const normalizeInteractionPayload = (payload = {}) => {
    if (!payload || typeof payload !== "object") {
        return payload
    }

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
 * Discord forbids toggling the ephemeral flag after the initial defer/reply.
 * When editing a deferred interaction we must strip the flag entirely.
 * @param {Object} payload
 * @returns {Object}
 */
const stripDeferredEphemeralFlag = (payload) => {
    if (!payload || typeof payload !== "object") {
        return payload
    }

    if (payload.flags !== MessageFlags.Ephemeral) {
        return payload
    }

    const next = { ...payload }
    delete next.flags
    return next
}

module.exports = {
    normalizeInteractionPayload,
    stripDeferredEphemeralFlag
}
