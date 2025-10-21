const logger = require("../../shared/logger")

const MANAGED_GUILD_CACHE_TTL_MS = 60 * 1000

const extractGuildIds = (payload) => {
    if (!payload) {
        return []
    }
    if (Array.isArray(payload)) {
        return payload
    }
    if (Array.isArray(payload.ids)) {
        return payload.ids
    }
    if (Array.isArray(payload.guilds)) {
        return payload.guilds
            .map((entry) => entry?.id)
            .filter(Boolean)
    }
    return []
}

const createDiscordDirectory = ({ rpcClient, managedGuildTtlMs = MANAGED_GUILD_CACHE_TTL_MS } = {}) => {
    const userCache = new Map()
    const guildCache = new Map()
    let managedGuildIds = new Set()
    let managedGuildsExpiresAt = 0

    const fetchUser = async(id) => {
        if (!id || !rpcClient) return null
        try {
            const user = await rpcClient.fetchUser(id)
            if (user) {
                userCache.set(id, user)
            }
            return user || null
        } catch (error) {
            logger.warn("Failed to fetch user from bot RPC", {
                scope: "botRpc",
                operation: "fetchUser",
                userId: id,
                message: error.message
            })
            return null
        }
    }

    const fetchGuild = async(id) => {
        if (!id || !rpcClient) return null
        try {
            const guild = await rpcClient.fetchGuild(id)
            if (guild) {
                guildCache.set(id, guild)
                managedGuildIds.add(String(id))
            }
            return guild || null
        } catch (error) {
            const level = error?.status === 404 ? "debug" : "warn"
            logger[level]("Failed to fetch guild from bot RPC", {
                scope: "botRpc",
                operation: "fetchGuild",
                guildId: id,
                message: error.message
            })
            return null
        }
    }

    const resolveUsername = async(id) => {
        if (!id) return null
        if (userCache.has(id)) {
            return userCache.get(id)?.tag || userCache.get(id)?.username || null
        }
        const user = await fetchUser(id)
        return user?.tag || user?.username || null
    }

    const lookupUserIdsByName = async(query) => {
        if (!rpcClient || !query) return []
        try {
            const result = await rpcClient.lookupUserIds(query)
            if (Array.isArray(result?.ids)) {
                return result.ids
            }
            return []
        } catch (error) {
            logger.warn("Failed to lookup user ids via RPC", {
                scope: "botRpc",
                operation: "lookupUserIds",
                message: error.message
            })
            return []
        }
    }

    const getManagedGuildIds = async({ force = false } = {}) => {
        const now = Date.now()
        if (!force && managedGuildIds.size > 0 && managedGuildsExpiresAt > now) {
            return managedGuildIds
        }
        if (!rpcClient || typeof rpcClient.listGuilds !== "function") {
            managedGuildsExpiresAt = now + managedGuildTtlMs
            return managedGuildIds
        }
        try {
            const payload = await rpcClient.listGuilds()
            const ids = extractGuildIds(payload)
            managedGuildIds = new Set(ids.map((value) => String(value)))
            managedGuildsExpiresAt = now + managedGuildTtlMs
        } catch (error) {
            logger.warn("Failed to list guilds from bot RPC", {
                scope: "botRpc",
                operation: "listGuilds",
                message: error.message
            })
            managedGuildsExpiresAt = now + Math.min(managedGuildTtlMs, 15000)
        }
        return managedGuildIds
    }

    return {
        users: {
            cache: userCache,
            fetch: fetchUser
        },
        guilds: {
            cache: guildCache,
            fetch: fetchGuild
        },
        getManagedGuildIds,
        resolveUsername,
        lookupUserIdsByName
    }
}

module.exports = createDiscordDirectory
