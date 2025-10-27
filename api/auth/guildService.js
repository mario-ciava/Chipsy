const { PermissionsBitField, PermissionFlagsBits } = require("discord.js")
const createCacheManager = require("./cacheManager")

const createGuildService = ({
    panelConfig,
    discordApi,
    guildDirectory,
    client,
    logger
}) => {
    const guildFetchConfig = panelConfig?.guilds?.fetch || {}
    const clampNumber = (value, fallback) => {
        const numeric = Number(value)
        return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
    }
    const cacheTtlMs = clampNumber(guildFetchConfig.cacheTtlMs, 5000)
    const cacheMaxEntries = clampNumber(guildFetchConfig.maxEntries, 250)
    const retryAfterFloorMs = clampNumber(guildFetchConfig.retryAfterFloorMs, 7000)
    const forceRefreshCooldownMs = clampNumber(guildFetchConfig.forceRefreshCooldownMs, 4000)
    const liveFetchDebounceMs = clampNumber(guildFetchConfig.liveFetchDebounceMs, 1000)

    const cache = createCacheManager({
        ttlMs: cacheTtlMs,
        maxEntries: cacheMaxEntries
    })

    const guildsRateLimit = new Map()
    const guildFetchMeta = new Map()
    const guildFetchInFlight = new Map()

    const getGuildFetchMeta = (token) => {
        if (!token) {
            return { lastLiveFetchAt: 0, lastForceRequestAt: 0 }
        }
        return guildFetchMeta.get(token) || { lastLiveFetchAt: 0, lastForceRequestAt: 0 }
    }

    const updateGuildFetchMeta = (token, updates = {}) => {
        if (!token) return
        const current = getGuildFetchMeta(token)
        guildFetchMeta.set(token, { ...current, ...updates })
    }

    const fetchGuildsLive = (token, factory) => {
        if (!token) {
            return factory()
        }
        if (guildFetchInFlight.has(token)) {
            return guildFetchInFlight.get(token)
        }
        const promise = factory()
            .finally(() => {
                guildFetchInFlight.delete(token)
            })
        guildFetchInFlight.set(token, promise)
        return promise
    }

    const readGuildCache = (token, { allowExpired = false } = {}) => {
        if (!token) return null
        return cache.get(token, { allowExpired })
    }

    const saveGuildCache = (token, payload) => {
        if (!token || !payload) return
        cache.set(token, payload, cacheTtlMs)
    }

    const noteGuildRateLimit = (token, retryAfterMs) => {
        if (!token) return
        const duration = clampNumber(retryAfterMs, retryAfterFloorMs)
        guildsRateLimit.set(token, Date.now() + duration)
    }

    const isGuildRateLimited = (token) => {
        if (!token) return { limited: false, remainingMs: 0 }
        const until = guildsRateLimit.get(token)
        if (!until) return { limited: false, remainingMs: 0 }
        const remainingMs = until - Date.now()
        if (remainingMs <= 0) {
            guildsRateLimit.delete(token)
            return { limited: false, remainingMs: 0 }
        }
        return { limited: true, remainingMs }
    }

    const parseRetryAfterMs = (error) => {
        const retryAfterRaw = error?.data?.retry_after
            || error?.response?.data?.retry_after
            || error?.response?.headers?.["retry-after"]
        const numericValue = Number(retryAfterRaw)
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
            return retryAfterFloorMs
        }
        const durationMs = numericValue > 1000 ? numericValue : numericValue * 1000
        return Math.max(durationMs, retryAfterFloorMs)
    }

    const fallbackManagedGuildIds = () => {
        const cacheRef = guildDirectory?.guilds?.cache || guildDirectory?.cache || client?.guilds?.cache
        if (!cacheRef) {
            return new Set()
        }
        const ids = []
        if (typeof cacheRef.keys === "function") {
            for (const key of cacheRef.keys()) {
                ids.push(String(key))
            }
        } else if (Array.isArray(cacheRef)) {
            cacheRef.forEach((guild) => {
                if (guild?.id) {
                    ids.push(String(guild.id))
                }
            })
        }
        return new Set(ids)
    }

    const normalizeToIdSet = (value) => {
        if (!value) {
            return new Set()
        }
        if (value instanceof Set) {
            return new Set(Array.from(value).map((entry) => String(entry)))
        }
        if (Array.isArray(value)) {
            return new Set(value.map((entry) => String(entry)))
        }
        if (value && typeof value === "object") {
            if (Array.isArray(value.ids)) {
                return new Set(value.ids.map((entry) => String(entry)))
            }
            if (Array.isArray(value.guilds)) {
                return new Set(
                    value.guilds
                        .map((entry) => entry?.id)
                        .filter(Boolean)
                        .map((entry) => String(entry))
                )
            }
        }
        return new Set()
    }

    const resolveManagedGuildIds = async({ forceRefresh = false } = {}) => {
        if (typeof guildDirectory?.getManagedGuildIds === "function") {
            try {
                const ids = await guildDirectory.getManagedGuildIds({ force: forceRefresh })
                return {
                    ids: normalizeToIdSet(ids),
                    authoritative: true
                }
            } catch (error) {
                logger?.warn?.("Managed guild lookup failed", {
                    scope: "auth",
                    operation: "getManagedGuildIds",
                    message: error.message
                })
            }
        }
        return {
            ids: fallbackManagedGuildIds(),
            authoritative: false
        }
    }

    const normalizeGuildId = (guild) => {
        if (!guild) return null
        if (typeof guild === "string" || typeof guild === "number") {
            const value = String(guild).trim()
            return value.length > 0 ? value : null
        }
        if (guild.id === undefined || guild.id === null) {
            return null
        }
        return String(guild.id)
    }

    const buildGuildPayload = async(guilds, { forceManagedRefresh = false } = {}) => {
        const safeGuilds = Array.isArray(guilds) ? guilds : []
        const { ids: resolvedManagedIds, authoritative } = await resolveManagedGuildIds({
            forceRefresh: forceManagedRefresh
        })
        const fallbackIds = fallbackManagedGuildIds()
        const knownManaged = new Set([
            ...(resolvedManagedIds instanceof Set ? [...resolvedManagedIds] : []),
            ...(fallbackIds instanceof Set ? [...fallbackIds] : [])
        ])
        const canProbeIndividually = typeof guildDirectory?.guilds?.fetch === "function"
            || typeof client?.guilds?.fetch === "function"
        const shouldProbe = !authoritative && canProbeIndividually

        const added = []
        const available = []

        const hasManagePermission = (guild) => {
            try {
                const permissions = guild.permissions ?? "0"
                const bitField = new PermissionsBitField(BigInt(permissions))
                return bitField.has(PermissionFlagsBits.ManageGuild)
            } catch (error) {
                return false
            }
        }

        const probeGuildPresence = async(guildId) => {
            if (!shouldProbe || !guildId) {
                return false
            }
            const fetcher = guildDirectory?.guilds?.fetch || client?.guilds?.fetch
            if (typeof fetcher !== "function") {
                return false
            }
            try {
                const result = await fetcher(guildId)
                if (result) {
                    knownManaged.add(guildId)
                    return true
                }
                return false
            } catch (error) {
                logger?.debug?.("Guild probe failed", {
                    scope: "auth",
                    operation: "probeGuild",
                    guildId,
                    message: error.message
                })
                return false
            }
        }

        for (const guild of safeGuilds) {
            const id = normalizeGuildId(guild)
            if (!id) {
                continue
            }
            let isManaged = knownManaged.has(id)
            if (!isManaged) {
                const present = await probeGuildPresence(id)
                if (present) {
                    isManaged = true
                }
            }
            if (isManaged) {
                added.push(guild)
                continue
            }
            if (hasManagePermission(guild)) {
                available.push(guild)
            }
        }

        return {
            all: safeGuilds,
            added,
            available
        }
    }

    const fetchGuildList = async({
        token,
        forceRefreshRequested = false
    }) => {
        const now = Date.now()
        const cachedEntry = readGuildCache(token, { allowExpired: true })
        const fetchMeta = getGuildFetchMeta(token)

        const lastForceRequestAt = fetchMeta.lastForceRequestAt || 0
        const timeSinceForceRequest = now - lastForceRequestAt
        const canThrottleForce = Boolean(cachedEntry)
        const forceCooldownActive = forceRefreshRequested
            && canThrottleForce
            && timeSinceForceRequest < forceRefreshCooldownMs

        if (forceRefreshRequested) {
            updateGuildFetchMeta(token, { lastForceRequestAt: now })
        }

        const honoringForceRefresh = forceRefreshRequested && !forceCooldownActive
        const cachedEntryExists = Boolean(cachedEntry)
        const needsLiveFetch = !cachedEntryExists || cachedEntry.expired || honoringForceRefresh

        if (!needsLiveFetch && cachedEntry) {
            return {
                payload: cachedEntry.value,
                meta: {
                    source: "cache",
                    cooldown: forceCooldownActive
                }
            }
        }

        const lastLiveFetchAt = fetchMeta.lastLiveFetchAt || 0
        const liveFetchCooldownActive = cachedEntryExists
            && (now - lastLiveFetchAt) < liveFetchDebounceMs

        if (liveFetchCooldownActive && cachedEntry) {
            return {
                payload: cachedEntry.value,
                meta: {
                    source: "cache",
                    stale: Boolean(cachedEntry.expired),
                    cooldown: true
                }
            }
        }

        const rateState = isGuildRateLimited(token)
        if (rateState.limited) {
            if (cachedEntry) {
                return {
                    payload: cachedEntry.value,
                    meta: {
                        source: "cache",
                        stale: Boolean(cachedEntry.expired),
                        rateLimited: true
                    }
                }
            }
            const error = new Error("Discord rate limited guild lookups. Try again later.")
            error.status = 429
            throw error
        }

        try {
            const payload = await fetchGuildsLive(token, async() => {
                const response = await discordApi.get("/users/@me/guilds", {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                })

                const builtPayload = await buildGuildPayload(response.data, {
                    forceManagedRefresh: honoringForceRefresh
                })
                saveGuildCache(token, builtPayload)
                guildsRateLimit.delete(token)
                updateGuildFetchMeta(token, { lastLiveFetchAt: Date.now() })

                return builtPayload
            })

            return {
                payload,
                meta: {
                    source: "live"
                }
            }
        } catch (error) {
            const status = error?.status || error?.response?.status
            if (status === 429) {
                const retryAfterMs = parseRetryAfterMs(error)
                noteGuildRateLimit(token, retryAfterMs)
                const cached = readGuildCache(token, { allowExpired: true })
                if (cached) {
                    return {
                        payload: cached.value,
                        meta: {
                            source: "cache",
                            stale: true,
                            rateLimited: true
                        }
                    }
                }
            }
            throw error
        }
    }

    const attachResponseMeta = ({ res, meta = {}, req, refreshRequested }) => {
        res.set("x-chipsy-guilds-source", meta.source || "live")
        if (meta.rateLimited) {
            res.set("x-chipsy-guilds-ratelimited", "1")
        }
        if (meta.cooldown) {
            res.set("x-chipsy-guilds-cooldown", "1")
        }

        const level = meta.rateLimited ? "warn" : (meta.cooldown ? "info" : "debug")
        const logMethod = typeof logger?.[level] === "function" ? logger[level].bind(logger) : logger?.info?.bind(logger)
        if (logMethod) {
            logMethod("Guild list served", {
                scope: "auth",
                event: "guilds-response",
                source: meta.source,
                stale: Boolean(meta.stale),
                rateLimited: Boolean(meta.rateLimited),
                cooldown: Boolean(meta.cooldown),
                userId: req.user?.id || req.session?.user?.id,
                requestId: req.requestId,
                refreshRequested
            })
        }
    }

    return {
        fetchGuildList,
        attachResponseMeta
    }
}

module.exports = createGuildService
