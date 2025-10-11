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
                    const profile = await resolvedDataHandler.getUserData(user.id)
                    profilePayload = mapProfilePayload(profile)
                } catch (error) {
                    client.logger?.warn?.("Failed to resolve profile data", {
                        scope: "auth",
                        operation: "getUserProfile",
                        userId: user.id,
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

    const isManagedGuild = (guildId) => {
        const cache = guildDirectory?.cache || client.guilds?.cache
        return Boolean(cache?.get?.(guildId))
    }

    const buildGuildPayload = (guilds) => {
        const safeGuilds = Array.isArray(guilds) ? guilds : []
        const added = safeGuilds.filter((guild) => isManagedGuild(guild.id))
        const available = safeGuilds.filter((guild) => {
            try {
                if (isManagedGuild(guild.id)) return false
                const permissions = guild.permissions ?? "0"
                const bitField = new PermissionsBitField(BigInt(permissions))
                return bitField.has(PermissionFlagsBits.ManageGuild)
            } catch (error) {
                return false
            }
        })
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

                const builtPayload = buildGuildPayload(response.data)
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
