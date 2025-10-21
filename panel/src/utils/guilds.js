const MANAGE_GUILD_FLAG = BigInt(1) << BigInt(5)

const toPermissionBigInt = (value) => {
    if (typeof value === "bigint") {
        return value
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return BigInt(value)
    }
    if (typeof value === "string" && value.trim().length > 0) {
        try {
            return BigInt(value.trim())
        } catch (error) {
            return null
        }
    }
    return null
}

export const getGuildId = (guild) => {
    if (!guild || guild.id === undefined || guild.id === null) {
        return null
    }
    return String(guild.id)
}

export const hasManageGuildPermission = (guild) => {
    if (!guild) return false
    if (guild.owner) return true
    const permValue = toPermissionBigInt(guild.permissions ?? guild.permissions_new)
    if (permValue === null) return false
    return (permValue & MANAGE_GUILD_FLAG) === MANAGE_GUILD_FLAG
}

export const normalizeGuildList = (list) => {
    if (!Array.isArray(list)) return []
    const normalized = []
    const seen = new Set()
    list.forEach((guild) => {
        if (!guild) return
        const id = getGuildId(guild)
        if (!id || seen.has(id)) {
            return
        }
        normalized.push({ ...guild, id })
        seen.add(id)
    })
    return normalized
}

export const sortGuildsByName = (list) => {
    if (!Array.isArray(list)) return []
    return [...list].sort((guildA, guildB) => {
        const nameA = (guildA?.name || "").toLowerCase()
        const nameB = (guildB?.name || "").toLowerCase()
        if (nameA === nameB) return 0
        return nameA > nameB ? 1 : -1
    })
}

export default {
    hasManageGuildPermission,
    normalizeGuildList,
    sortGuildsByName
}
