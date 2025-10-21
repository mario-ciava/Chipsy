const express = require("express")
const bodyParser = require("body-parser")
const fetch = require("node-fetch")
const logger = require("../utils/logger")
const createAdminService = require("../../shared/services/adminService")
const { constants, internalApi: internalApiConfig } = require("../../config")

const createDiscordApi = (fetchImpl = fetch) => {
    const request = async(path, options = {}) => {
        const response = await fetchImpl(`https://discord.com/api${path}`, options)
        const text = await response.text()
        let data

        try {
            data = text ? JSON.parse(text) : undefined
        } catch {
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

const asyncHandler = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
}

const serializeUser = (user) => {
    if (!user) return null
    const avatarUrl = typeof user.displayAvatarURL === "function"
        ? user.displayAvatarURL({ extension: "png", size: 128 })
        : null

    return {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator ?? null,
        tag: user.tag ?? (user.username && typeof user.discriminator !== "undefined"
            ? `${user.username}#${user.discriminator}`
            : user.username),
        globalName: user.globalName ?? user.displayName ?? null,
        bot: Boolean(user.bot),
        avatar: avatarUrl
    }
}

const collectNameCandidates = (entity) => {
    if (!entity) return []
    const source = entity.user || entity
    const names = [
        entity.tag,
        entity.username,
        entity.globalName,
        entity.displayName,
        entity.nickname,
        source?.tag,
        source?.username,
        source?.globalName,
        source?.displayName
    ]

    if (source?.username && typeof source?.discriminator !== "undefined") {
        names.push(`${source.username}#${source.discriminator}`)
    }

    return names.filter(Boolean)
}

const buildLookupHelper = (client) => {
    const MAX_MATCHES = 50

    return async(query = "") => {
        const normalized = query.trim().toLowerCase()
        if (!normalized) return []

        const matches = new Set()
        const checkCandidate = (candidate) => {
            if (matches.size >= MAX_MATCHES || !candidate) return
            const names = collectNameCandidates(candidate)
            const hasMatch = names.some((value) => typeof value === "string" && value.toLowerCase().includes(normalized))
            if (hasMatch) {
                const id = candidate.id || candidate.user?.id
                if (id) {
                    matches.add(id)
                }
            }
        }

        const visitCache = (cache, extractor = (entry) => entry) => {
            if (!cache) return
            if (typeof cache.values === "function") {
                for (const value of cache.values()) {
                    if (matches.size >= MAX_MATCHES) break
                    checkCandidate(extractor(value))
                }
                return
            }
            if (typeof cache.forEach === "function") {
                cache.forEach((value) => {
                    if (matches.size >= MAX_MATCHES) return
                    checkCandidate(extractor(value))
                })
                return
            }
            if (Array.isArray(cache)) {
                cache.forEach((value) => {
                    if (matches.size >= MAX_MATCHES) return
                    checkCandidate(extractor(value))
                })
            }
        }

        visitCache(client?.users?.cache)
        visitCache(client?.guilds?.cache, (guild) => {
            if (!guild?.members?.cache) return null
            guild.members.cache.forEach((member) => {
                checkCandidate(member)
                if (member?.user) {
                    checkCandidate(member.user)
                }
            })
            return null
        })

        return Array.from(matches)
    }
}

const startInternalServer = ({
    client,
    webSocket,
    statusService,
    config = internalApiConfig,
    discordApi = createDiscordApi(fetch)
} = {}) => {
    if (!client || !statusService) {
        throw new Error("Internal server requires a ready Discord client and status service")
    }

    if (!config?.enabled) {
        logger.info("Internal control server disabled", { scope: "internal" })
        return null
    }

    if (!config.token) {
        logger.warn("INTERNAL_API_TOKEN is not set - internal API will refuse all requests", {
            scope: "internal"
        })
    }

    const app = express()
    app.disable("x-powered-by")
    app.use(bodyParser.json({ limit: constants.server.bodyLimit }))
    app.use(bodyParser.urlencoded({ extended: true, limit: constants.server.bodyLimit }))

    const authenticate = (req, res, next) => {
        if (!config.token) {
            return res.status(503).json({ message: "Internal token not configured" })
        }
        const token = req.get("x-internal-token") || req.query.token
        if (!token || token !== config.token) {
            return res.status(401).json({ message: "Unauthorized" })
        }
        return next()
    }

    const router = express.Router()
    router.use(authenticate)

    const buildInviteRedirectUri = () => {
        const origin = (client.config?.redirectUri || constants.urls.botApiLocal).replace(/\/$/, "")
        return `${origin}/control_panel`
    }

    const clientCredentials = Buffer.from(`${client.config?.id}:${client.config?.secret}`).toString("base64")

    const adminService = createAdminService({
        client,
        webSocket,
        statusService,
        healthChecks: client.healthChecks || {},
        discordApi,
        clientCredentials,
        getInviteRedirectUri: buildInviteRedirectUri
    })

    const lookupUserIdsByName = buildLookupHelper(client)

    router.get("/status", asyncHandler(async(req, res) => {
        const payload = await statusService.getBotStatus({ reason: "internal:status" })
        res.json(payload)
    }))

    router.post("/status/refresh", asyncHandler(async(req, res) => {
        const payload = await statusService.refreshBotStatus({ reason: "internal:refresh" })
        res.json(payload)
    }))

    router.get("/status/guilds/:guildId", asyncHandler(async(req, res) => {
        const guild = await statusService.getGuildSnapshot(req.params.guildId, { reason: "internal:guild" })
        if (!guild) {
            return res.status(404).json({ message: "Guild not found" })
        }
        res.json(guild)
    }))

    router.delete("/status/guilds/:guildId", asyncHandler(async(req, res) => {
        await statusService.invalidateGuildSnapshot(req.params.guildId)
        res.status(204).end()
    }))

    router.patch("/bot", asyncHandler(async(req, res) => {
        const { enabled, actor } = req.body || {}
        if (typeof enabled !== "boolean") {
            return res.status(400).json({ message: "enabled flag required" })
        }
        const status = await adminService.setBotEnabled(enabled, { actor, reason: "internal:toggle" })
        res.json(status)
    }))

    router.get("/admin/client", asyncHandler(async(req, res) => {
        const payload = adminService.getClientConfig()
        res.json(payload)
    }))

    router.get("/admin/guilds/:guildId", asyncHandler(async(req, res) => {
        const guild = await adminService.getGuild(req.params.guildId)
        res.json(guild)
    }))

    router.post("/admin/guilds/:guildId/leave", asyncHandler(async(req, res) => {
        await adminService.leaveGuild(req.params.guildId, { actor: req.body?.actor })
        res.status(204).end()
    }))

    router.post("/admin/invite/complete", asyncHandler(async(req, res) => {
        const { code, guildId, meta } = req.body || {}
        if (!code || !guildId) {
            return res.status(400).json({ message: "code and guildId are required" })
        }
        const result = await adminService.completeInvite({ code, guildId, meta })
        res.json(result)
    }))

    router.get("/admin/actions", asyncHandler(async(req, res) => {
        res.json(adminService.listActions())
    }))

    router.post("/admin/actions/:actionId", asyncHandler(async(req, res) => {
        const { actionId } = req.params
        const { metadata } = req.body || {}
        const result = await adminService.executeAction(actionId, { ...(metadata || {}), reason: "internal:action" })
        res.json(result)
    }))

    router.get("/admin/tables", asyncHandler(async(req, res) => {
        const payload = adminService.listTables()
        res.json(payload)
    }))

    router.post("/admin/tables/:tableId/actions", asyncHandler(async(req, res) => {
        const { tableId } = req.params
        const { action, actor } = req.body || {}
        if (!action) {
            return res.status(400).json({ message: "action is required" })
        }
        const result = await adminService.controlTable({
            tableId,
            action,
            actor
        })
        res.json(result)
    }))

    router.post("/admin/logs", asyncHandler(async(req, res) => {
        const { level, message, logType, userId } = req.body || {}
        if (!message) {
            return res.status(400).json({ message: "message is required" })
        }
        await adminService.createLog({ level, message, logType, userId })
        res.status(204).end()
    }))

    router.get("/admin/logs", asyncHandler(async(req, res) => {
        const { logType, limit, cursor } = req.query || {}
        const result = await adminService.getLogs({ logType, limit, cursor })
        res.json(result)
    }))

    router.delete("/admin/logs", asyncHandler(async(req, res) => {
        const result = await adminService.cleanupLogs()
        res.json(result)
    }))

    router.get("/discord/guilds", asyncHandler(async(req, res) => {
        const entries = []
        if (client?.guilds?.cache) {
            if (typeof client.guilds.cache.forEach === "function") {
                client.guilds.cache.forEach((guild) => {
                    if (!guild?.id) return
                    entries.push({
                        id: guild.id,
                        name: guild.name,
                        icon: typeof guild.iconURL === "function" ? guild.iconURL({ extension: "png", size: 64 }) : null
                    })
                })
            } else if (typeof client.guilds.cache.values === "function") {
                for (const guild of client.guilds.cache.values()) {
                    if (!guild?.id) continue
                    entries.push({
                        id: guild.id,
                        name: guild.name,
                        icon: typeof guild.iconURL === "function" ? guild.iconURL({ extension: "png", size: 64 }) : null
                    })
                }
            }
        }
        res.json({ guilds: entries, ids: entries.map((entry) => entry.id) })
    }))

    router.get("/discord/users/:id", asyncHandler(async(req, res) => {
        const userId = req.params.id
        if (!userId) {
            return res.status(400).json({ message: "User id required" })
        }
        const cached = client.users?.cache?.get?.(userId)
        if (cached) {
            return res.json(serializeUser(cached))
        }
        if (typeof client.users?.fetch !== "function") {
            return res.status(503).json({ message: "User directory unavailable" })
        }
        try {
            const fetched = await client.users.fetch(userId)
            res.json(serializeUser(fetched))
        } catch (error) {
            res.status(404).json({ message: error.message })
        }
    }))

    router.get("/discord/users", asyncHandler(async(req, res) => {
        const query = req.query.q || ""
        const ids = await lookupUserIdsByName(query)
        res.json({ ids })
    }))

    router.get("/discord/guilds/:guildId", asyncHandler(async(req, res) => {
        const guild = client.guilds?.cache?.get?.(req.params.guildId)
            || (typeof client.guilds?.fetch === "function" ? await client.guilds.fetch(req.params.guildId).catch(() => null) : null)
        if (!guild) {
            return res.status(404).json({ message: "Guild not found" })
        }
        res.json({
            id: guild.id,
            name: guild.name,
            icon: typeof guild.iconURL === "function" ? guild.iconURL({ extension: "png", size: 128 }) : null,
            memberCount: guild.memberCount,
            ownerId: typeof guild.fetchOwner === "function" ? (await guild.fetchOwner().catch(() => null))?.id ?? null : null
        })
    }))

    router.get("/health/discord", asyncHandler(async(req, res) => {
        res.json({
            alive: client.ws?.status === 0,
            status: client.ws?.status ?? null,
            ping: client.ws?.ping ?? null,
            guilds: client.guilds?.cache?.size ?? 0,
            shards: Array.isArray(client.ws?.shards) ? client.ws.shards.size : client.ws?.shards?.size ?? null
        })
    }))

    app.use(config.path || "/internal", router)

    app.use((err, req, res, next) => {
        logger.error("Internal API error", {
            scope: "internal",
            message: err.message,
            stack: err.stack
        })
        res.status(err.status || 500).json({
            message: err.message || "Internal error"
        })
    })

    const port = Number(config.port) || 7310
    const host = config.host || "0.0.0.0"
    const server = app.listen(port, host, () => {
        logger.info(`Internal control server listening on ${host}:${port}`, { scope: "internal" })
    })

    return {
        app,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    logger.error("Failed to close internal server", {
                        scope: "internal",
                        message: error.message
                    })
                    reject(error)
                } else {
                    resolve()
                }
            })
        })
    }
}

module.exports = startInternalServer
