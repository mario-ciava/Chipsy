const express = require("express")
const { constants } = require("../../config")

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
        defaultRedirectUri = constants.urls.vueDevLocal
    } = dependencies

    const router = express.Router()

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

    router.get("/user", async(req, res, next) => {
        const token = getAccessToken(req)

        if (!token) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const response = await discordApi.get("/users/@me", {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            })

            const user = response.data
            const isAdmin = user.id === client.config.ownerid
            const csrfToken = ensureCsrfToken ? ensureCsrfToken(req) : null
            const enrichedUser = { ...user, isAdmin }
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

            if (isAdmin) {
                req.isAdmin = true
            }

            return res.status(200).json(enrichedUser)
        } catch (error) {
            return next(buildDiscordError(error, "Failed to fetch user information"))
        }
    })

    const isManagedGuild = (guildId) => Boolean(client.guilds?.cache?.get?.(guildId))

    router.get("/guilds", async(req, res, next) => {
        const token = getAccessToken(req)

        if (!token) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const response = await discordApi.get("/users/@me/guilds", {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            })

            const guilds = response.data

            const added = guilds.filter((guild) => isManagedGuild(guild.id))
            const available = guilds.filter((guild) => {
                try {
                    if (isManagedGuild(guild.id)) return false
                    const permissions = guild.permissions ?? "0"
                    const bitField = new PermissionsBitField(BigInt(permissions))
                    return bitField.has(PermissionFlagsBits.ManageGuild)
                } catch (error) {
                    return false
                }
            })

            return res.status(200).json({
                all: guilds,
                added,
                available
            })
        } catch (error) {
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
