const clampNumber = (value, fallback) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return fallback
    }
    return numeric
}

const createCacheManager = ({ ttlMs = 5000, maxEntries = 250 } = {}) => {
    const normalizedTtl = clampNumber(ttlMs, 5000)
    const normalizedMax = clampNumber(maxEntries, 250)
    const store = new Map()

    const set = (key, value, customTtl) => {
        if (!key) return
        const ttl = clampNumber(customTtl, normalizedTtl)
        store.set(key, {
            value,
            expiresAt: Date.now() + ttl
        })
        enforceLimit()
    }

    const get = (key, { allowExpired = false } = {}) => {
        if (!key) return null
        const entry = store.get(key)
        if (!entry) return null
        const expired = entry.expiresAt <= Date.now()
        if (expired && !allowExpired) {
            store.delete(key)
            return null
        }
        return {
            value: entry.value,
            expired
        }
    }

    const del = (key) => {
        if (!key) return
        store.delete(key)
    }

    const clear = () => store.clear()

    const size = () => store.size

    const enforceLimit = () => {
        while (store.size > normalizedMax) {
            const oldestKey = store.keys().next().value
            if (oldestKey === undefined) break
            store.delete(oldestKey)
        }
    }

    return {
        set,
        get,
        delete: del,
        clear,
        size
    }
}

module.exports = createCacheManager
