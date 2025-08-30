const express = require("express")
const bodyparser = require("body-parser")
const session = require("express-session")
const helmet = require("helmet")
const Discord = require("discord.js")
const fetch = require("node-fetch")
const crypto = require("crypto")
const createSessionStore = require("../util/createSessionStore")

const createAuthRouter = require("./routes/auth")
const createEnhancedAdminRouter = require("./routes/adminEnhanced")
const createUsersRouter = require("./routes/users")
const createHealthRouter = require("./routes/health")

const { logger: structuredLogger, requestLogger } = require("./middleware/structuredLogger")
const {
    globalLimiter,
    authLimiter,
    adminReadLimiter,
    adminWriteLimiter,
    criticalActionLimiter
} = require("./middleware/rateLimiter")
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler")
const createStatusWebSocketServer = require("./websocket/statusServer")

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
        sessionOptions = {},
        inviteRedirectPath = "/control_panel"
    } = options

    const fetchImpl = fetchOverride || fetch
    const discordApi = discordApiOverride || createDiscordApi(fetchImpl)

    const app = express()
    const router = express.Router()
    const tokenCache = new Map()

    // Security headers with Helmet
    app.use(helmet({
        contentSecurityPolicy: false, // Disable for API
        crossOriginEmbedderPolicy: false,
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    }))

    // Trust proxy (for accurate IP detection behind load balancers)
    app.set("trust proxy", 1)

    // Request ID and structured logging
    app.use(requestLogger)

    app.use(bodyparser.json({ limit: "10mb" }))
    app.use(bodyparser.urlencoded({ extended: true, limit: "10mb" }))

    const sessionMaxAge = Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: sessionMaxAge,
        ...(sessionOptions.cookie || {})
    }

    const resolvedSecret = sessionOptions.secret || process.env.SESSION_SECRET

    if (!resolvedSecret || resolvedSecret.length < 32) {
        throw new Error(
            "SESSION_SECRET must be provided and contain at least 32 characters. Configure the environment variable or pass sessionOptions.secret."
        )
    }

    const sessionConfig = {
        resave: false,
        saveUninitialized: false,
        ...sessionOptions,
        secret: resolvedSecret,
        cookie: cookieOptions
    }

    const sessionStore =
        sessionOptions.store ||
        options.sessionStore ||
        createSessionStore({
            session,
            client,
            logger: client?.logger
        })

    if (sessionStore) {
        sessionConfig.store = sessionStore
    } else if (process.env.NODE_ENV === "production") {
        throw new Error(
            "A persistent session store is required in production. Configure SESSION_STORE or provide sessionOptions.store."
        )
    }

    app.use(session(sessionConfig))

    const ensureCsrfToken = (req) => {
        if (!req.session) return null
        if (!req.session.csrfToken) {
            req.session.csrfToken = crypto.randomBytes(32).toString("hex")
        }
        return req.session.csrfToken
    }

    const requireCsrfToken = (req, res, next) => {
        const token = req.headers["x-csrf-token"]
        const sessionToken = req.session?.csrfToken

        if (!token || !sessionToken || token !== sessionToken) {
            return res.status(403).json({ message: "403: Forbidden" })
        }

        return next()
    }

    app.use((req, res, next) => {
        ensureCsrfToken(req)
        next()
    })

    const unique = (values = []) => Array.from(new Set(values.filter(Boolean)))
    const envAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)

    const allowedOrigins = unique([
        client.config?.redirectUri,
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8082",
        ...envAllowedOrigins
    ])

    app.use((req, res, next) => {
        const requestOrigin = req.headers.origin
        if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
            res.setHeader("Access-Control-Allow-Origin", requestOrigin)
            res.setHeader("Vary", "Origin")
        }
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT,PATCH,DELETE")
        res.setHeader(
            "Access-Control-Allow-Headers",
            "token, code, content-type, x-csrf-token, x-redirect-origin, authorization"
        )
        res.setHeader("Access-Control-Allow-Credentials", "true")

        if (req.method === "OPTIONS") {
            res.status(204).end()
            return
        }

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

    // Global rate limiting
    const limiterMiddleware = rateLimiter === undefined ? globalLimiter : rateLimiter
    if (limiterMiddleware) {
        app.use("/api", limiterMiddleware)
    }

    const clientCredentials = Buffer.from(`${client.config.id}:${client.config.secret}`).toString("base64")
    const defaultScopes = ["identify", "guilds"]

    const getAccessToken = (req) => req.headers.token || req.session?.oauth?.accessToken || req.user?.token

    const buildInviteRedirectUri = () => {
        const origin = (client.config?.redirectUri || "http://localhost:8082").replace(/\/$/, "")
        const normalizedPath = inviteRedirectPath.startsWith("/") ? inviteRedirectPath : `/${inviteRedirectPath}`
        return `${origin}${normalizedPath}`
    }

    const authRouter = createAuthRouter({
        data: clientCredentials,
        discordApi,
        tokenCache,
        webSocket,
        getAccessToken,
        client,
        buildDiscordError,
        PermissionsBitField,
        PermissionFlagsBits,
        scopes: defaultScopes,
        defaultRedirectUri: client.config?.redirectUri,
        ensureCsrfToken,
        requireCsrfToken,
        allowedRedirectOrigins: allowedOrigins
    })

    // Auth router (auth rate limiting applied in auth router itself)
    router.use("/", authRouter)

    const { router: adminRouter, handlers: adminHandlers, middleware: adminMiddleware } = createEnhancedAdminRouter({
        client,
        webSocket,
        requireCsrfToken,
        getAccessToken,
        ensureCsrfToken,
        healthChecks: client.healthChecks,
        discordApi,
        clientCredentials,
        getInviteRedirectUri: buildInviteRedirectUri,
        statusService: client.statusService
    })

    // All admin endpoints are under /admin prefix
    router.use("/admin", adminRouter)

    // Backwards compatibility for legacy /api/client endpoint
    if (adminHandlers?.getClient) {
        router.get("/client", adminHandlers.getClient)
    }

    if (adminHandlers?.turnOff) {
        router.post("/turnoff", requireCsrfToken, adminHandlers.turnOff)
    }

    if (adminHandlers?.turnOn) {
        router.post("/turnon", requireCsrfToken, adminHandlers.turnOn)
    }

    const usersRouter = createUsersRouter({
        client,
        getAccessToken
    })

    router.use("/users", usersRouter)

    const { router: healthRouter } = createHealthRouter({
        client,
        healthChecks: client.healthChecks
    })

    // Health check endpoints (no rate limiting, no auth)
    app.use("/api/health", healthRouter)

    app.use("/api", router)

    // 404 handler
    app.use(notFoundHandler)

    // Global error handler
    app.use(errorHandler)

    let httpServer = options.server || null
    if (listen) {
        httpServer = app.listen(port)
    }

    let wsBridge = null
    const statusService = options.statusService || client.statusService

    if (!options.disableWebSocket && httpServer && statusService) {
        try {
            wsBridge = createStatusWebSocketServer({
                server: httpServer,
                webSocketEmitter: webSocket,
                statusService,
                path: options.webSocketPath
            })
            structuredLogger.info("WebSocket bridge initialized", { scope: "server" })
        } catch (error) {
            structuredLogger.error("Failed to initialize WebSocket bridge", {
                scope: "server",
                message: error.message
            })
        }
    } else if (!statusService) {
        structuredLogger.warn("Status service not available - WebSocket bridge disabled", { scope: "server" })
    }

    app.httpServer = httpServer
    app.wsBridge = wsBridge

    return app
}
