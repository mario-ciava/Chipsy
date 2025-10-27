const express = require("express")
const config = require("../../config")
const { constants, panel } = config
const { buildPermissionMatrix, ROLES } = require("../services/accessControlService")
const { mapProfileRecord } = require("../../shared/mappers/userMapper")
const { buildAccessPayload } = require("../../shared/mappers/accessMapper")
const createOAuthService = require("../auth/oauthService")
const createUserProvisioner = require("../auth/userProvisioner")
const createGuildService = require("../auth/guildService")

const SESSION_EXPIRED_MESSAGE = constants.messages?.sessionExpired
    || "401: Session expired. Please log in again."

const parseForceRefresh = (value) => {
    if (typeof value !== "string") return false
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "1" || normalized === "force"
}

const createAuthRouter = (dependencies) => {
    const {
        data,
        discordApi,
        tokenCache,
        webSocket,
        getAccessToken,
        client,
        buildDiscordError,
        ensureCsrfToken,
        requireCsrfToken,
        allowedRedirectOrigins = [],
        scopes = ["identify", "guilds"],
        defaultRedirectUri = constants.urls.vueDevLocal,
        accessControl,
        dataHandler,
        guildDirectory,
        ownerId: ownerIdOverride,
        createTokenBinding
    } = dependencies

    const router = express.Router()
    const resolvedAccessControl = accessControl || client?.accessControl
    const resolvedDataHandler = dataHandler || client?.dataHandler

    const oauthService = createOAuthService({
        discordApi,
        clientCredentials: data,
        scopes,
        defaultRedirectUri,
        allowedRedirectOrigins,
        logger: client?.logger
    })

    const userProvisioner = createUserProvisioner({
        dataHandler: resolvedDataHandler,
        panelConfig: panel,
        logger: client?.logger
    })

    const guildService = createGuildService({
        panelConfig: panel,
        discordApi,
        guildDirectory,
        client,
        logger: client?.logger
    })

    const applyRedirectUri = (req) => {
        const candidate = req.query?.redirectUri || req.query?.redirect_uri || client?.config?.redirectUri
        const redirectUri = oauthService.resolveRedirectUri(candidate)
        if (client?.config) {
            client.config.redirectUri = redirectUri
        }
        return redirectUri
    }

    router.get("/auth/state", (req, res, next) => {
        try {
            const state = oauthService.generateState(req)
            const redirectUri = applyRedirectUri(req)
            res.status(200).json({ state, redirectUri })
        } catch (error) {
            next(error)
        }
    })

    router.get("/auth", async(req, res, next) => {
        const code = req.query.code || req.headers.code
        const state = req.query.state || req.headers["x-oauth-state"]

        if (!code || !state) {
            return res.status(400).json({ message: "400: Missing code or state" })
        }

        if (!oauthService.validateState(req, state)) {
            return res.status(401).json({ message: "401: Invalid OAuth state" })
        }

        try {
            const redirectUri = applyRedirectUri(req)
            client?.logger?.info?.("OAuth redirect resolved", {
                scope: "auth",
                redirectUri,
                requestId: req.requestId
            })

            const tokenData = await oauthService.exchangeCode({ code, redirectUri })

            req.session.oauth = {
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                scope: tokenData.scope,
                redirectUri
            }

            webSocket?.emit("auth", {
                token: tokenData.access_token,
                scp: scopes
            })

            res.status(200).json(tokenData)
        } catch (error) {
            next(buildDiscordError(error, "Failed to exchange authorization code"))
        }
    })

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
            const accessPayload = buildAccessPayload({
                userId: user.id,
                ownerId,
                accessRecord
            })

            let profilePayload = null
            if (resolvedDataHandler?.getUserData) {
                try {
                    const { profile, created, error: provisioningError } = await userProvisioner.ensureProfileProvisioned(user.id)
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
                    profilePayload = mapProfileRecord(profile)
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

            const binding = typeof createTokenBinding === "function" ? createTokenBinding(req) : null
            const cachedUser = {
                ...enrichedUser,
                token
            }

            req.session.user = cachedUser
            req.session.oauth = { ...(req.session.oauth || {}), accessToken: token }
            if (binding) {
                req.session.tokenBinding = binding
            }
            tokenCache.set(token, binding ? { user: cachedUser, binding } : cachedUser)

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

    router.get("/guilds", async(req, res, next) => {
        const token = getAccessToken(req)

        if (!token) {
            return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
        }

        const forceRefreshRequested = parseForceRefresh(req.query?.refresh)

        try {
            const result = await guildService.fetchGuildList({
                token,
                forceRefreshRequested
            })
            guildService.attachResponseMeta({ res, meta: result.meta, req, refreshRequested: forceRefreshRequested })
            return res.status(200).json({
                ...result.payload,
                meta: result.meta
            })
        } catch (error) {
            if (error.status === 429) {
                return res.status(429).json({ message: "429: Discord rate limited guild lookups. Try again later." })
            }
            return next(buildDiscordError(error, "Failed to fetch user guilds"))
        }
    })

    router.post("/logout", requireCsrfToken, (req, res) => {
        if (!req.user?.id) {
            return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
        }

        const requestedUserId = req.body?.userId || req.body?.user?.id
        if (requestedUserId && requestedUserId !== req.user.id) {
            return res.status(403).json({ message: "403: Forbidden" })
        }

        const token = req.headers.token || req.session?.oauth?.accessToken
        if (token) {
            tokenCache.delete(token)
        }

        const payload = { id: req.user.id }
        if (req.session) {
            req.session.destroy(() => {})
        }

        webSocket?.emit("logout", payload)
        return res.status(200).json({ message: "200: OK" })
    })

    return router
}

module.exports = createAuthRouter
