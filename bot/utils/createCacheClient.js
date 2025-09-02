const { info, warn, error } = require("./logger")

const DEFAULT_TTL_SECONDS = 30

const createMemoryCache = () => {
    const store = new Map()

    const get = async(key) => {
        const entry = store.get(key)
        if (!entry) return null
        if (entry.expiresAt && entry.expiresAt <= Date.now()) {
            store.delete(key)
            return null
        }
        return entry.value
    }

    const set = async(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => {
        const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null
        store.set(key, { value, expiresAt })
    }

    const del = async(key) => {
        store.delete(key)
    }

    const reset = async() => {
        store.clear()
    }

    return {
        type: "memory",
        isMemory: true,
        get,
        set,
        del,
        reset,
        disconnect: async() => reset(),
    }
}

const normalizeConfig = (config = {}) => {
    if (!config) return {}
    const normalized = { ...config }
    if (typeof normalized.tls === "string") {
        normalized.tls = normalized.tls === "true"
    }
    return normalized
}

const createCacheClient = async(config = {}) => {
    const normalized = normalizeConfig(config)
    const hasRedisConfig = Boolean(normalized.url || normalized.host)

    if (!hasRedisConfig) {
        info("Redis cache disabled - using in-memory cache", { scope: "cache" })
        return createMemoryCache()
    }

    try {
        const { createClient } = require("redis")

        const client = createClient({
            url: normalized.url,
            socket: normalized.url ? undefined : {
                host: normalized.host,
                port: normalized.port,
                tls: normalized.tls ? {} : undefined
            },
            password: normalized.password || undefined,
            database: normalized.database ?? normalized.db
        })

        client.on("error", (err) => {
            error("Redis client error", { scope: "cache", message: err.message })
        })

        client.on("reconnecting", () => {
            warn("Redis client reconnecting", { scope: "cache" })
        })

        await client.connect()
        info("Redis cache connected", { scope: "cache" })

        const get = async(key) => {
            const raw = await client.get(key)
            if (!raw) return null
            try {
                return JSON.parse(raw)
            } catch (err) {
                warn("Failed to parse cached payload", { scope: "cache", key, message: err.message })
                return null
            }
        }

        const set = async(key, value, ttlSeconds = DEFAULT_TTL_SECONDS) => {
            const payload = JSON.stringify(value)
            if (ttlSeconds) {
                await client.setEx(key, ttlSeconds, payload)
            } else {
                await client.set(key, payload)
            }
        }

        const del = async(key) => client.del(key)

        const reset = async() => client.flushAll()

        return {
            type: "redis",
            isMemory: false,
            get,
            set,
            del,
            reset,
            disconnect: () => client.disconnect()
        }
    } catch (err) {
        error("Failed to initialize Redis cache", { scope: "cache", message: err.message })
        return createMemoryCache()
    }
}

module.exports = createCacheClient
