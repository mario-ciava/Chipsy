const { PermissionFlagsBits } = require("discord.js")
const config = require("../../config")

const OWNER_ID = config?.discord?.ownerId || null

const hasGuildPermission = (member) => {
    if (!member?.permissions) return false
    return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator)
}

const hasChannelPermission = (member, channel) => {
    if (!member || !channel?.permissionsFor) return false
    const permissions = channel.permissionsFor(member)
    if (!permissions) return false
    return permissions.has(PermissionFlagsBits.ManageChannels)
        || permissions.has(PermissionFlagsBits.ManageGuild)
        || permissions.has(PermissionFlagsBits.Administrator)
}

const canEditConfig = ({ scopeType, user, guild, channel, member }) => {
    const resolvedScope = typeof scopeType === "string" ? scopeType.toLowerCase() : ""
    const requesterId = user?.id

    if (OWNER_ID && requesterId === OWNER_ID) {
        return { allowed: true }
    }

    if (resolvedScope === "user") {
        return { allowed: true }
    }

    const resolvedMember = member || (guild?.members?.resolve ? guild.members.resolve(user) : null)
    if (!guild || !resolvedMember) {
        return { allowed: false, reason: "Guild context required." }
    }

    if (resolvedScope === "guild") {
        const allowed = hasGuildPermission(resolvedMember)
        return {
            allowed,
            reason: allowed ? null : "Manage Guild permission required."
        }
    }

    if (resolvedScope === "channel") {
        const allowed = hasChannelPermission(resolvedMember, channel)
        return {
            allowed,
            reason: allowed ? null : "Manage Channel permission required."
        }
    }

    return { allowed: false, reason: "Invalid scope." }
}

module.exports = {
    canEditConfig
}
