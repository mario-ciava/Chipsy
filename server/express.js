const express = require("express")
const bodyparser = require("body-parser")
const session = require("express-session")
const Discord = require("discord.js")
const fetch = require("node-fetch")

const { PermissionsBitField, PermissionFlagsBits } = Discord

const formatErrorMessage = (status, message) => `${status}: ${message}`

const createHttpError = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
}

const buildDiscordError = (error, fallbackMessage) => {
    const status = error.status || error.response?.status || 500
    const message = error.data?.message
        || error.response?.data?.message
        || error.response?.statusText
        || error.message
        || fallbackMessage
        || "Internal Server Error"

    return createHttpError(status, message)
}

const createDefaultRateLimiter = ({ windowMs = 60 * 1000, max = 60 } = {}) => {
    const hits = new Map()

    return (req, res, next) => {
        const now = Date.now()
        const key = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "global"
        let entry = hits.get(key)

        if (!entry || now > entry.reset) {
            entry = { count: 0, reset: now + windowMs }
        }

        entry.count += 1
        hits.set(key, entry)

        if (entry.count > max) {
            const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000))
            res.setHeader("Retry-After", retryAfter)
            return res.status(429).json({ message: "429: Too Many Requests" })
        }

        if (hits.size > 1000) {
            for (const [storedKey, value] of hits) {
                if (value.reset <= now) {
                    hits.delete(storedKey)
                }
            }
        }

        return next()
    }
}

const createRequestLogger = (logFn = console.log) => (req, res, next) => {
    const start = Date.now()
    res.on("finish", () => {
        const duration = Date.now() - start
        logFn(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`)
    })

    next()
}

const createDiscordApi = (fetchImpl) => {
    const request = async(path, options = {}) => {
        const response = await fetchImpl(`https://discord.com/api${path}`, options)
        const text = await response.text()
        let data

        try {
            data = text ? JSON.parse(text) : undefined
        } catch (error) {
            data = undefined
        }

        if (!response.ok) {
            const error = new Error(data?.message || response.statusText)
            error.status = response.status
            error.data = data
            throw error
        }

        return { data, status: response.status }
    }

    return {
        post: (path, body, options = {}) => request(path, { method: "POST", body, ...options }),
        get: (path, options = {}) => request(path, { method: "GET", ...options })
    }
}

module.exports = (client, webSocket, options = {}) => {
    const {
        listen = true,
        port = 3000,
        rateLimiter,
        logger,
        fetch: fetchOverride,
        discordApi: discordApiOverride,
        sessionOptions = {}
    } = options

    const fetchImpl = fetchOverride || fetch
    const discordApi = discordApiOverride || createDiscordApi(fetchImpl)

    const app = express()
    const router = express.Router({ automatic405: true })
    const tokenCache = new Map()

    app.use(bodyparser.json())
    app.use(bodyparser.urlencoded({ extended: true }))

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        ...(sessionOptions.cookie || {})
    }

    const sessionConfig = {
        resave: false,
        saveUninitialized: false,
        ...sessionOptions,
        secret: sessionOptions.secret || process.env.SESSION_SECRET || client.config.secret || "chipsy-session-secret",
        cookie: cookieOptions
    }

    app.use(session(sessionConfig))

    const loggerMiddleware = logger === undefined
        ? createRequestLogger(client?.logger?.info ? (message) => client.logger.info(message, { scope: "express" }) : undefined)
        : logger

    if (loggerMiddleware) {
        app.use(loggerMiddleware)
    }

    app.use((req, res, next) => {
        res.append("Access-Control-Allow-Origin", ["http://localhost:8080"])
        res.append("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT")
        res.append("Access-Control-Allow-Headers", "token, code, content-type")
        next()
    })

    app.use((req, res, next) => {
        const sessionUser = req.session?.user

        if (sessionUser) {
            req.user = sessionUser
        } else if (req.headers.token && tokenCache.has(req.headers.token)) {
            req.user = tokenCache.get(req.headers.token)
        }

        if (req.user?.isAdmin) {
            req.isAdmin = true
        }

        next()
    })

    const limiterMiddleware = rateLimiter === undefined ? createDefaultRateLimiter() : rateLimiter
    if (limiterMiddleware) {
        app.use("/api", limiterMiddleware)
    }

    const data = Buffer.from(`${client.config.id}:${client.config.secret}`).toString("base64")
    const defaultScopes = ["identify", "guilds"]

    const getAccessToken = (req) => req.headers.token || req.session?.oauth?.accessToken || req.user?.token

    router.get("/auth", async(req, res, next) => {
        if (!req.headers.code) {
            return res.status(400).json({ message: "400: Bad Request" })
        }

        try {
            const params = new URLSearchParams({
                grant_type: "authorization_code",
                code: req.headers.code,
                redirect_uri: "http://localhost:8080",
                scope: defaultScopes.join(" ")
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
                scp: defaultScopes
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
            const enrichedUser = { ...user, isAdmin }

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

            const added = guilds.filter((guild) => client.guilds?.cache?.get?.(guild.id))
            const available = guilds.filter((guild) => {
                try {
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

    router.post("/logout", (req, res) => {
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

    router.get("/turnoff", (req, res) => {
        if (!getAccessToken(req)) {
            return res.status(400).json({ message: "400: Bad request" })
        } else if (req.isAdmin) {
            client.config.enabled = false
            webSocket?.emit("disable")
            return res.status(200).json({ message: "200: OK" })
        }

        return res.status(403).json({ message: "403: Forbidden" })
    })

    router.get("/turnon", (req, res) => {
        if (!getAccessToken(req)) {
            return res.status(400).json({ message: "400: Bad request" })
        } else if (req.isAdmin) {
            client.config.enabled = true
            webSocket?.emit("enable")
            return res.status(200).json({ message: "200: OK" })
        }

        return res.status(403).json({ message: "403: Forbidden" })
    })

    router.get("/client", (req, res) => {
        if (!getAccessToken(req)) {
            return res.status(400).json({ message: "400: Bad request" })
        } else if (req.isAdmin) {
            return res.status(200).json(client.config)
        }

        return res.status(403).json({ message: "403: Forbidden" })
    })

    router.get("/guild", (req, res) => {
        if (!getAccessToken(req)) {
            return res.status(400).json({ message: "400: Bad request" })
        } else if (req.isAdmin) {
            const guildId = req.query?.id

            if (!guildId) {
                return res.status(400).json({ message: "400: Bad request" })
            }

            const guild = client.guilds?.cache?.get?.(guildId)

            if (!guild) {
                return res.status(404).json({ message: "404: Guild not found" })
            }

            return res.status(200).json(guild)
        }

        return res.status(403).json({ message: "403: Forbidden" })
    })

    app.use("/api", router)

    app.use((req, res) => {
        res.status(404).json({ message: "404: Invalid endpoint" })
    })

    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        const status = err.status || 500
        const message = err.message || "Internal Server Error"

        if (client?.logger?.error) {
            client.logger.error("Express request failed", {
                scope: "express",
                status,
                message,
                stack: err.stack
            })
        } else {
            console.error(err)
        }

        res.status(status).json({ message: formatErrorMessage(status, message) })
    })

    if (listen) {
        app.listen(port)
    }

    return app
}
