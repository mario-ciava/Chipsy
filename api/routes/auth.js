const express = require("express")
const config = require("../../config")
const { constants, panel } = config
const { buildPermissionMatrix, ROLES } = require("../services/accessControlService")

const SESSION_EXPIRED_MESSAGE = constants.messages?.sessionExpired
    || "401: Session expired. Please log in again."

const createAuthRouter = (dependencies) => {
    const {
        data,
        discordApi,
        tokenCache,
        webSocket,
        getAccessToken,
        client,
        buildDiscordError,
        PermissionsBitField,
        PermissionFlagsBits,
        ensureCsrfToken,
        requireCsrfToken,
        allowedRedirectOrigins = [],
        scopes = ["identify", "guilds"],
        defaultRedirectUri = constants.urls.vueDevLocal,
        accessControl,
        dataHandler,
        guildDirectory,
        ownerId: ownerIdOverride
    } = dependencies

    const router = express.Router()
    const resolvedAccessControl = accessControl || client?.accessControl
    const resolvedDataHandler = dataHandler || client?.dataHandler

    const toPositiveInteger = (value, fallback) => {
        const numeric = Number(value)
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback
        }
        return Math.trunc(numeric)
    }

    const profileProvisioningConfig = Object.freeze({
        enabled: panel?.users?.profiles?.autoProvisionOnLogin !== false,
        retries: toPositiveInteger(panel?.users?.profiles?.provisionRetryLimit, 2)
    })

    const ensureProfileProvisioned = async(userId) => {
        if (!userId || !resolvedDataHandler?.getUserData) {
            return { profile: null, created: false }
        }

        const readProfile = async() => {
            try {
                const record = await resolvedDataHandler.getUserData(userId)
                return { profile: record || null, error: null }
            } catch (error) {
                return { profile: null, error }
            }
        }

        const initial = await readProfile()
        if (initial.error) {
            return { profile: null, created: false, error: initial.error }
        }
        if (initial.profile) {
            return { profile: initial.profile, created: false }
        }

        if (!profileProvisioningConfig.enabled || typeof resolvedDataHandler.createUserData !== "function") {
            return { profile: null, created: false }
        }

        const attempts = Math.max(1, profileProvisioningConfig.retries)

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const createdProfile = await resolvedDataHandler.createUserData(userId)
                return { profile: createdProfile, created: true }
            } catch (creationError) {
                if (creationError?.code === "ER_DUP_ENTRY") {
                    const retry = await readProfile()
                    if (retry.error) {
                        return { profile: null, created: false, error: retry.error }
                    }
                    if (retry.profile) {
                        return { profile: retry.profile, created: false }
                    }
                }

                if (attempt === attempts - 1) {
                    return { profile: null, created: false, error: creationError }
                }
            }
        }

        return { profile: null, created: false }
    }

    const guildFetchConfig = panel?.guilds?.fetch || {}
    const toPositiveNumber = (value, fallback) => {
        const numeric = Number(value)
        return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
    }
    const GUILD_CACHE_TTL_MS = toPositiveNumber(guildFetchConfig.cacheTtlMs, 5000)
    const GUILD_CACHE_MAX_ENTRIES = toPositiveNumber(guildFetchConfig.maxEntries, 250)
    const GUILD_RETRY_FLOOR_MS = toPositiveNumber(guildFetchConfig.retryAfterFloorMs, 7000)
    const GUILD_FORCE_REFRESH_COOLDOWN_MS = toPositiveNumber(guildFetchConfig.forceRefreshCooldownMs, 4000)
    const GUILD_LIVE_FETCH_DEBOUNCE_MS = toPositiveNumber(guildFetchConfig.liveFetchDebounceMs, 1000)

    const guildsCache = new Map()
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

    const pruneGuildCache = () => {
        if (guildsCache.size <= GUILD_CACHE_MAX_ENTRIES) {
            return
        }

        const now = Date.now()
        for (const [key, entry] of guildsCache.entries()) {
            if (guildsCache.size <= GUILD_CACHE_MAX_ENTRIES) {
                break
            }
            if (!entry || entry.expiresAt <= now) {
                guildsCache.delete(key)
            }
        }

        while (guildsCache.size > GUILD_CACHE_MAX_ENTRIES) {
            const oldestKey = guildsCache.keys().next().value
            if (!oldestKey) {
                break
            }
            guildsCache.delete(oldestKey)
        }
    }

    const saveGuildCache = (token, payload) => {
        if (!token || !payload) return
        guildsCache.set(token, {
            payload,
            expiresAt: Date.now() + GUILD_CACHE_TTL_MS
        })
        pruneGuildCache()
    }

    const readGuildCache = (token, { allowExpired = false } = {}) => {
        if (!token) return null
        const entry = guildsCache.get(token)
        if (!entry) return null
        const expired = entry.expiresAt <= Date.now()
        if (expired && !allowExpired) {
            guildsCache.delete(token)
            return null
        }
        return {
            payload: entry.payload,
            expired
        }
    }

    const noteGuildRateLimit = (token, retryAfterMs) => {
        if (!token) return
        const duration = toPositiveNumber(retryAfterMs, GUILD_RETRY_FLOOR_MS)
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
            return GUILD_RETRY_FLOOR_MS
        }
        const durationMs = numericValue > 1000 ? numericValue : numericValue * 1000
        return Math.max(durationMs, GUILD_RETRY_FLOOR_MS)
    }

    const parseForceRefresh = (value) => {
        if (typeof value !== "string") return false
        const normalized = value.trim().toLowerCase()
        return normalized === "true" || normalized === "1" || normalized === "force"
    }

    const respondWithGuilds = (req, res, payload, meta = {}) => {
        const responseMeta = {
            source: meta.source || "live",
            stale: Boolean(meta.stale),
            rateLimited: Boolean(meta.rateLimited),
            cooldown: Boolean(meta.cooldown)
        }
        res.set("x-chipsy-guilds-source", responseMeta.source)
        if (responseMeta.rateLimited) {
            res.set("x-chipsy-guilds-ratelimited", "1")
        }
        if (responseMeta.cooldown) {
            res.set("x-chipsy-guilds-cooldown", "1")
        }

        const logger = client?.logger
        if (logger && typeof logger.info === "function") {
            const level = responseMeta.rateLimited ? "warn" : (responseMeta.cooldown ? "info" : "debug")
            const logMethod = typeof logger[level] === "function" ? logger[level].bind(logger) : logger.info.bind(logger)
            const logPayload = {
                scope: "auth",
                event: "guilds-response",
                source: responseMeta.source,
                stale: responseMeta.stale,
                rateLimited: responseMeta.rateLimited,
                cooldown: responseMeta.cooldown,
                userId: req.user?.id || req.session?.user?.id,
                requestId: req.requestId,
                refreshRequested: parseForceRefresh(req.query?.refresh)
            }
            logMethod("Guild list served", logPayload)
        }

        return res.status(200).json({
            ...payload,
            meta: responseMeta
        })
    }

    const TRUSTED_PROTOCOLS = new Set(["http:", "https:"])

    const normalizeOrigin = (value = "") => value.replace(/\/$/, "")

    const allowedOriginsSet = new Set([normalizeOrigin(defaultRedirectUri), ...allowedRedirectOrigins.map(normalizeOrigin)])

    const sanitizeRedirectOrigin = (candidate) => {
        const fallback = normalizeOrigin(defaultRedirectUri)
        if (!candidate || typeof candidate !== "string") {
            client.config.redirectUri = fallback
            return fallback
        }

        try {
            const parsed = new URL(candidate)
            if (!TRUSTED_PROTOCOLS.has(parsed.protocol)) {
                client.config.redirectUri = fallback
                return fallback
            }
            const sanitized = normalizeOrigin(parsed.origin)
            if (!allowedOriginsSet.has(sanitized)) {
                client.config.redirectUri = fallback
                return fallback
            }
            client.config.redirectUri = sanitized
            return sanitized
        } catch (error) {
            client.config.redirectUri = fallback
            return fallback
        }
    }

    const resolveRedirectOrigin = (req) => {
        const headerValue = req.headers["x-redirect-origin"]
        if (Array.isArray(headerValue)) {
            return sanitizeRedirectOrigin(headerValue[0])
        }
        return sanitizeRedirectOrigin(headerValue)
    }

    router.get("/auth", async(req, res, next) => {
        if (!req.headers.code) {
            return res.status(400).json({ message: "400: Bad Request" })
        }

        try {
            const redirectOrigin = resolveRedirectOrigin(req)
            const redirectLogPayload = {
                scope: "auth",
                redirectOrigin,
                requestId: req.requestId,
                headersOrigin: req.headers["x-redirect-origin"] || null
            }
            if (client.logger?.warn) {
                client.logger.warn("OAuth redirect origin resolved", redirectLogPayload)
            } else {
                console.warn("[auth] OAuth redirect origin resolved", redirectLogPayload)
            }
            const params = new URLSearchParams({
                grant_type: "authorization_code",
                code: req.headers.code,
                redirect_uri: redirectOrigin,
                scope: scopes.join(" ")
            })

            const response = await discordApi.post("/oauth2/token", params.toString(), {
                headers: {
                    Authorization: `Basic ${data}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            })

            const tokenData = response.data

            req.session.oauth = {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                scope: tokenData.scope
            }

            webSocket?.emit("auth", {
                token: tokenData.access_token,
                scp: scopes
            })

            return res.status(200).json(tokenData)
        } catch (error) {
            return next(buildDiscordError(error, "Failed to exchange authorization code"))
        }
    })

    const mapProfilePayload = (record) => {
        if (!record) return null
        return {
            id: record.id,
            money: record.money,
            gold: record.gold,
            level: record.level,
            currentExp: record.current_exp,
            requiredExp: record.required_exp,
            handsPlayed: record.hands_played,
            handsWon: record.hands_won,
            biggestWon: record.biggest_won,
            biggestBet: record.biggest_bet,
            nextReward: record.next_reward,
            lastPlayed: record.last_played,
            joinDate: record.join_date
        }
    }

    router.get("/user", async(req, res, next) => {
        const token = getAccessToken(req)

        if (!token) {
            return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
        }

        try {
            const response = await discordApi.get("/users/@me", {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            })

            const user = response.data
            let accessRecord = null

            if (resolvedAccessControl?.getAccessRecord) {
                accessRecord = await resolvedAccessControl.getAccessRecord(user.id)
            }

            const ownerId = ownerIdOverride || client.config.ownerid
            const derivedRole = (() => {
                if (accessRecord?.role) return accessRecord.role
                if (user.id === ownerId) return ROLES.MASTER
                return ROLES.USER
            })()

            if (accessRecord?.isBlacklisted) {
                return res.status(403).json({ message: "403: Forbidden" })
            }

            const permissions = buildPermissionMatrix(derivedRole)
            const csrfToken = ensureCsrfToken ? ensureCsrfToken(req) : null
            const accessPayload = {
                isBlacklisted: Boolean(accessRecord?.isBlacklisted),
                isWhitelisted: Boolean(accessRecord?.isWhitelisted)
            }

            let profilePayload = null
            if (resolvedDataHandler?.getUserData) {
                try {
                    const { profile, created, error: provisioningError } = await ensureProfileProvisioned(user.id)
                    if (created) {
                        client.logger?.info?.("Auto-provisioned profile on login", {
                            scope: "auth",
                            operation: "provisionUserProfile",
                            userId: user.id,
                            requestId: req.requestId || null
                        })
                    } else if (provisioningError) {
                        client.logger?.warn?.("Failed to auto-provision profile on login", {
                            scope: "auth",
                            operation: "provisionUserProfile",
                            userId: user.id,
                            requestId: req.requestId || null,
                            message: provisioningError.message
                        })
                    }
                    profilePayload = mapProfilePayload(profile)
                } catch (error) {
                    client.logger?.warn?.("Failed to resolve profile data", {
                        scope: "auth",
                        operation: "getUserProfile",
                        userId: user.id,
                        requestId: req.requestId || null,
                        message: error.message
                    })
                }
            }

            const enrichedUser = {
                ...user,
                role: permissions.role,
                isAdmin: permissions.canAccessPanel,
                isModerator: permissions.isModerator,
                permissions,
                access: accessPayload
            }

            if (profilePayload) {
                enrichedUser.profile = profilePayload
            }

            if (csrfToken) {
                enrichedUser.csrfToken = csrfToken
            }

            const cachedUser = {
                ...enrichedUser,
                token
            }

            req.session.user = cachedUser
            req.session.oauth = { ...(req.session.oauth || {}), accessToken: token }
            tokenCache.set(token, cachedUser)

            req.permissions = permissions
            if (permissions.canAccessPanel) {
                req.isAdmin = true
            }
            if (permissions.canViewLogs) {
                req.isModerator = true
            }

            return res.status(200).json(enrichedUser)
        } catch (error) {
            return next(buildDiscordError(error, "Failed to fetch user information"))
        }
    })

    const resolveGuildCache = () => {
        if (guildDirectory?.guilds?.cache) {
            return guildDirectory.guilds.cache
        }
        if (guildDirectory?.cache) {
            return guildDirectory.cache
        }
        return client?.guilds?.cache
    }

    const fallbackManagedGuildIds = () => {
        const cache = resolveGuildCache()
        if (!cache) {
            return new Set()
        }
        const ids = []
        if (typeof cache.keys === "function") {
            for (const key of cache.keys()) {
                ids.push(String(key))
            }
        } else if (Array.isArray(cache)) {
            cache.forEach((guild) => {
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
                client?.logger?.warn?.("Managed guild lookup failed", {
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
                client?.logger?.debug?.("Guild probe failed", {
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

    router.get("/guilds", async(req, res, next) => {
        const token = getAccessToken(req)

        if (!token) {
            return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
        }

        const now = Date.now()
        const forceRefreshRequested = parseForceRefresh(req.query?.refresh)
        const cachedEntry = readGuildCache(token, { allowExpired: true })
        const fetchMeta = getGuildFetchMeta(token)

        const lastForceRequestAt = fetchMeta.lastForceRequestAt || 0
        const timeSinceForceRequest = now - lastForceRequestAt
        const canThrottleForce = Boolean(cachedEntry)
        const forceCooldownActive = forceRefreshRequested
            && canThrottleForce
            && timeSinceForceRequest < GUILD_FORCE_REFRESH_COOLDOWN_MS

        if (forceRefreshRequested) {
            updateGuildFetchMeta(token, { lastForceRequestAt: now })
        }

        const honoringForceRefresh = forceRefreshRequested && !forceCooldownActive
        const cachedEntryExists = Boolean(cachedEntry)
        const needsLiveFetch = !cachedEntryExists || cachedEntry.expired || honoringForceRefresh

        if (!needsLiveFetch && cachedEntry) {
            return respondWithGuilds(req, res, cachedEntry.payload, {
                source: "cache",
                cooldown: forceCooldownActive
            })
        }

        const lastLiveFetchAt = fetchMeta.lastLiveFetchAt || 0
        const liveFetchCooldownActive = cachedEntryExists
            && (now - lastLiveFetchAt) < GUILD_LIVE_FETCH_DEBOUNCE_MS

        if (liveFetchCooldownActive && cachedEntry) {
            return respondWithGuilds(req, res, cachedEntry.payload, {
                source: "cache",
                stale: Boolean(cachedEntry.expired),
                cooldown: true
            })
        }

        const rateState = isGuildRateLimited(token)
        if (rateState.limited) {
            if (cachedEntry) {
                return respondWithGuilds(req, res, cachedEntry.payload, {
                    source: "cache",
                    stale: Boolean(cachedEntry.expired),
                    rateLimited: true
                })
            }
            return res.status(429).json({ message: "429: Discord rate limited guild lookups. Try again later." })
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

            return respondWithGuilds(req, res, payload, { source: "live" })
        } catch (error) {
            const status = error?.status || error?.response?.status
            if (status === 429) {
                const retryAfterMs = parseRetryAfterMs(error)
                noteGuildRateLimit(token, retryAfterMs)
                if (cachedEntry) {
                    return respondWithGuilds(req, res, cachedEntry.payload, {
                        source: "cache",
                        stale: true,
                        rateLimited: true
                    })
                }
            }
            return next(buildDiscordError(error, "Failed to fetch user guilds"))
        }
    })

    router.post("/logout", requireCsrfToken, (req, res) => {
        if (!req.body?.user) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        const token = req.body?.token || req.headers.token || req.session?.oauth?.accessToken
        if (token) {
            tokenCache.delete(token)
        }

        if (req.session) {
            req.session.destroy(() => {})
        }

        webSocket?.emit("logout", req.body.user)
        return res.status(200).json({ message: "200: OK" })
    })

    return router
}

module.exports = createAuthRouter
