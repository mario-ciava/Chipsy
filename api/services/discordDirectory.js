const logger = require("../../shared/logger")

const createDiscordDirectory = ({ rpcClient } = {}) => {
    const userCache = new Map()
    const guildCache = new Map()

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
            }
            return guild || null
        } catch (error) {
            logger.warn("Failed to fetch guild from bot RPC", {
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

    return {
        users: {
            cache: userCache,
            fetch: fetchUser
        },
        guilds: {
            cache: guildCache,
            fetch: fetchGuild
        },
        resolveUsername,
        lookupUserIdsByName
    }
}

module.exports = createDiscordDirectory
