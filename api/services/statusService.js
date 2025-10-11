const { info, warn } = require("../../shared/logger")

const STATUS_CACHE_KEY = "bot:status"
const GUILD_CACHE_PREFIX = "bot:guild:"
const DEFAULT_STATUS_TTL = 30
const DEFAULT_GUILD_TTL = 60

const safeToISOString = (value) => {
    if (!value) return null
    try {
        return new Date(value).toISOString()
    } catch (err) {
        return null
    }
}

const serializeGuild = (guild) => {
    if (!guild) return null

    const base = typeof guild.toJSON === "function" ? guild.toJSON() : guild

    return {
        id: base.id,
        name: base.name,
        icon: base.icon || base.iconURL?.() || null,
        memberCount: base.memberCount ?? null,
        ownerId: base.ownerId || base.ownerID || null,
        joinedTimestamp: base.joinedTimestamp || null,
        joinedAt: safeToISOString(base.joinedAt),
        features: Array.isArray(base.features) ? base.features : [],
        verified: Boolean(base.verified),
        partnered: Boolean(base.partnered),
        description: base.description || null
    }
}

const createStatusService = ({ client, cache, webSocket }) => {
    let lastStatus = null
    let lastStatusAt = 0
    let broadcaster = null

    const hasCache = Boolean(cache && typeof cache.get === "function")

    const readFromCache = async(key) => {
        if (!hasCache) return null
        try {
            return await cache.get(key)
        } catch (err) {
            warn("Failed to read from cache", { scope: "status", key, message: err.message })
            return null
        }
    }

    const writeToCache = async(key, value, ttl) => {
        if (!hasCache) return
        try {
            await cache.set(key, value, ttl)
        } catch (err) {
            warn("Failed to write to cache", { scope: "status", key, message: err.message })
        }
    }

    const deleteFromCache = async(key) => {
        if (!hasCache) return
        try {
            await cache.del(key)
        } catch (err) {
            warn("Failed to delete from cache", { scope: "status", key, message: err.message })
        }
    }

    const computeStatus = async() => {
        const guildCount = client.guilds?.cache?.size ?? 0
        const health = {}

        if (typeof client.healthChecks?.mysql === "function") {
            try {
                health.mysql = await client.healthChecks.mysql()
            } catch (err) {
                health.mysql = { alive: false, error: err.message }
            }
        }

        return {
            enabled: Boolean(client.config?.enabled),
            guildCount,
            shardCount: Array.isArray(client.ws?.shards) ? client.ws.shards.size : null,
            latency: client.ws?.ping ?? null,
            uptime: client.uptime ?? null,
            updatedAt: new Date().toISOString(),
            health
        }
    }

    const broadcastStatus = (status, meta = {}) => {
        if (!status) return
        const payload = { status, meta }
        try {
            webSocket?.emit?.("status:update", payload)
        } catch (err) {
            warn("Failed to emit status:update event", { scope: "status", message: err.message })
        }
        if (typeof broadcaster === "function") {
            try {
                broadcaster(payload)
            } catch (err) {
                warn("Status broadcaster failed", { scope: "status", message: err.message })
            }
        }
    }

    const getBotStatus = async({ forceRefresh = false, reason = "request", ...meta } = {}) => {
        if (!forceRefresh) {
            const now = Date.now()
            if (lastStatus && now - lastStatusAt < DEFAULT_STATUS_TTL * 500) {
                return lastStatus
            }

            const cached = await readFromCache(STATUS_CACHE_KEY)
            if (cached) {
                lastStatus = cached
                lastStatusAt = now
                return cached
            }
        }

        const status = await computeStatus()
        lastStatus = status
        lastStatusAt = Date.now()
        await writeToCache(STATUS_CACHE_KEY, status, DEFAULT_STATUS_TTL)

        if (forceRefresh) {
            broadcastStatus(status, { reason, ...meta })
        }

        return status
    }

    const refreshBotStatus = async(meta = {}) => {
        return getBotStatus({ forceRefresh: true, ...meta })
    }

    const getGuildSnapshot = async(guildId, { forceRefresh = false } = {}) => {
        if (!guildId) return null
        const cacheKey = `${GUILD_CACHE_PREFIX}${guildId}`

        if (!forceRefresh) {
            const cached = await readFromCache(cacheKey)
            if (cached) {
                return cached
            }
        }

        const guild = client.guilds?.cache?.get?.(guildId)
            || (typeof client.guilds?.fetch === "function" ? await client.guilds.fetch(guildId).catch((err) => {
                warn("Failed to fetch guild for cache", { scope: "status", guildId, message: err.message })
                return null
            }) : null)

        if (!guild) return null

        const serialized = serializeGuild(guild)
        await writeToCache(cacheKey, serialized, DEFAULT_GUILD_TTL)
        return serialized
    }

    const invalidateGuildSnapshot = async(guildId) => {
        if (!guildId) return
        await deleteFromCache(`${GUILD_CACHE_PREFIX}${guildId}`)
    }

    const registerBroadcaster = (fn) => {
        broadcaster = fn
    }

    info("Status service initialized", { scope: "status", cache: cache?.type || "memory" })

    return {
        getBotStatus,
        refreshBotStatus,
        broadcastStatus,
        getGuildSnapshot,
        invalidateGuildSnapshot,
        registerBroadcaster
    }
}

module.exports = createStatusService
