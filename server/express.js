const express = require("express")
const bodyparser = require("body-parser")
const session = require("express-session")
const helmet = require("helmet")
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const { PermissionsBitField, PermissionFlagsBits } = require("discord.js")
const createSessionStore = require("../bot/utils/createSessionStore")
const { constants } = require("../config")
const { requestLogger, logger: structuredLogger } = require("./middleware/structuredLogger")
const { globalLimiter } = require("./middleware/rateLimiter")
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler")
const createAuthRouter = require("./routes/auth")
const createUsersRouter = require("./routes/users")
const createHealthRouter = require("./routes/health")
const createEnhancedAdminRouter = require("./routes/adminEnhanced")
const createStatusWebSocketServer = require("./websocket/statusServer")
const createTokenCache = require("./utils/tokenCache")
const { buildPermissionMatrix } = require("./services/accessControlService")

const buildDiscordError = (error, fallbackMessage) => {
    const status = error.status || error.response?.status || 500
    const description =
        error.data?.error_description
        || error.response?.data?.error_description
        || error.data?.description
        || error.response?.data?.description
    const message = description
        || error.data?.message
        || error.response?.data?.message
        || error.response?.statusText
        || error.message
        || fallbackMessage
        || "Internal Server Error"

    const err = new Error(message)
    err.status = status
    if (error.data || error.response?.data) {
        err.details = error.data || error.response?.data
    }
    return err
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
        port = constants.server.defaultPort,
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
    const apiRouter = express.Router()
    const v1Router = express.Router()
    const legacyRouter = express.Router()
    const tokenCache = createTokenCache({
        ttlMs: Number(process.env.TOKEN_CACHE_TTL_MS) || constants.server.tokenCacheTtlMs,
        maxEntries: Number(process.env.TOKEN_CACHE_MAX_ENTRIES) || constants.server.tokenCacheMaxEntries
    })

    // Security headers with Helmet
    app.use(helmet({
        contentSecurityPolicy: false, // Disable for API
        crossOriginEmbedderPolicy: false,
        hsts: {
            maxAge: constants.server.hstsMaxAge,
            includeSubDomains: true,
            preload: true
        }
    }))

    // Trust proxy (for accurate IP detection behind load balancers)
    app.set("trust proxy", 1)

    // Request ID and structured logging
    app.use(requestLogger)

    app.use(bodyparser.json({ limit: constants.server.bodyLimit }))
    app.use(bodyparser.urlencoded({ extended: true, limit: constants.server.bodyLimit }))

    const sessionMaxAge = Number(process.env.SESSION_MAX_AGE_MS) || constants.server.sessionMaxAge

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
        constants.urls.vueDevLocal,
        constants.urls.vueLegacyLocal,
        constants.urls.botApiLocal,
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

    const resolvePermissions = (user) => {
        if (!user) return null
        if (user.permissions && user.permissions.role === user.role) {
            return user.permissions
        }
        return buildPermissionMatrix(user.role)
    }

    app.use((req, res, next) => {
        const sessionUser = req.session?.user

        if (sessionUser) {
            req.user = sessionUser
        } else if (req.headers.token) {
            const cachedUser = tokenCache.get(req.headers.token)
            if (cachedUser) {
                req.user = cachedUser
            }
        }

        if (req.user) {
            const permissions = resolvePermissions(req.user)
            if (permissions) {
                req.permissions = permissions
                req.user.permissions = permissions
                req.user.role = permissions.role

                if (permissions.canAccessPanel) {
                    req.isAdmin = true
                }

                if (permissions.canViewLogs) {
                    req.isModerator = true
                }
            }
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
        const origin = (client.config?.redirectUri || constants.urls.botApiLocal).replace(/\/$/, "")
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
    v1Router.use("/", authRouter)
    legacyRouter.use("/", authRouter)

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
    v1Router.use("/admin", adminRouter)
    legacyRouter.use("/admin", adminRouter)

    // Backwards compatibility for legacy /api/client endpoint
    if (adminHandlers?.getClient) {
        legacyRouter.get("/client", adminHandlers.getClient)
    }

    if (adminHandlers?.turnOff) {
        legacyRouter.post("/turnoff", requireCsrfToken, adminHandlers.turnOff)
    }

    if (adminHandlers?.turnOn) {
        legacyRouter.post("/turnon", requireCsrfToken, adminHandlers.turnOn)
    }

    const usersRouter = createUsersRouter({
        client,
        getAccessToken,
        requireCsrfToken
    })

    v1Router.use("/users", usersRouter)
    legacyRouter.use("/users", usersRouter)

    const { router: healthRouter } = createHealthRouter({
        client,
        healthChecks: client.healthChecks
    })

    // Health check endpoints (no rate limiting, no auth)
    v1Router.use("/health", healthRouter)
    apiRouter.use("/health", healthRouter)

    apiRouter.use("/v1", v1Router)

    if (legacyRouter.stack.length > 0) {
        apiRouter.use("/", legacyRouter)
    }

    app.use("/api", apiRouter)

    // Serve static files from the Vue build output (web/dist)
    const publicPath = path.join(__dirname, "../web/dist")
    const indexPath = path.join(publicPath, "index.html")
    const hasBuiltFrontend = fs.existsSync(indexPath)

    if (hasBuiltFrontend) {
        // In production: serve static files and SPA fallback
        app.use(express.static(publicPath))

        // SPA fallback - serve index.html for all non-API routes (Vue Router history mode)
        app.get("*", (req, res, next) => {
            // Skip API routes
            if (req.path.startsWith("/api")) {
                return next()
            }
            // Serve index.html for all other routes
            res.sendFile(indexPath)
        })
    }

    // 404 handler (only reached if file not found)
    app.use(notFoundHandler)

    // Global error handler (must be last middleware)
    app.use(errorHandler)

    // ========================================================================
    // SERVER INITIALIZATION
    // NOTA: Gli errori di listen (es. EADDRINUSE) devono essere gestiti dal
    // chiamante tramite httpServer.on('error', handler). Vedi server/index.js
    // ========================================================================
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
