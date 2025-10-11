const clampNumber = (value, fallback) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const resolveCleanupInterval = (ttlMs) => {
    const minInterval = 30 * 1000;
    const maxInterval = 5 * 60 * 1000;
    const halfTtl = Math.floor(ttlMs / 2);
    return Math.max(minInterval, Math.min(halfTtl || minInterval, maxInterval));
};

const createTokenCache = ({
    ttlMs = 15 * 60 * 1000,
    maxEntries = 500,
    cleanupIntervalMs
} = {}) => {
    const normalizedTtl = clampNumber(ttlMs, 60 * 1000);
    const normalizedMaxEntries = clampNumber(maxEntries, 1);
    const normalizedCleanupInterval = clampNumber(
        cleanupIntervalMs,
        resolveCleanupInterval(normalizedTtl)
    );

    const store = new Map();
    let cleanupTimer = null;

    const isExpired = (entry) => !entry || entry.expiresAt <= Date.now();

    const pruneExpired = () => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (!entry || entry.expiresAt <= now) {
                store.delete(key);
            }
        }
    };

    const enforceLimit = () => {
        while (store.size > normalizedMaxEntries) {
            const oldestKey = store.keys().next().value;
            if (oldestKey === undefined) break;
            store.delete(oldestKey);
        }
    };

    const ensureCleanupTimer = () => {
        if (cleanupTimer) return;
        cleanupTimer = setInterval(pruneExpired, normalizedCleanupInterval);
        if (typeof cleanupTimer.unref === "function") {
            cleanupTimer.unref();
        }
    };

    const set = (key, value, customTtlMs) => {
        const ttl = clampNumber(customTtlMs, normalizedTtl);
        store.set(key, {
            value,
            expiresAt: Date.now() + ttl
        });
        enforceLimit();
        ensureCleanupTimer();
    };

    const get = (key) => {
        const entry = store.get(key);
        if (isExpired(entry)) {
            store.delete(key);
            return undefined;
        }
        return entry?.value;
    };

    const has = (key) => {
        const entry = store.get(key);
        if (isExpired(entry)) {
            store.delete(key);
            return false;
        }
        return true;
    };

    const deleteKey = (key) => store.delete(key);
    const clear = () => store.clear();
    const size = () => store.size;

    const dispose = () => {
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
        }
        clear();
    };

    return {
        get,
        set,
        has,
        delete: deleteKey,
        clear,
        size,
        prune: pruneExpired,
        dispose
    };
};

module.exports = createTokenCache;
