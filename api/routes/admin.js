const express = require("express")
const { logger } = require("../middleware/structuredLogger")
const { constants } = require("../../config")
const createAdminServiceFactory = require("../../shared/services/adminService")
const { adminSchemas, validate } = require("../validation/schemas")
const {
    adminReadLimiter,
    adminWriteLimiter,
    criticalActionLimiter,
    logWriteLimiter
} = require("../middleware/rateLimiter")

const SESSION_EXPIRED_MESSAGE = constants.messages?.sessionExpired
    || "401: Session expired. Please log in again."

const respondWithServiceError = (error, res, next) => {
    if (error?.status) {
        const payload = { message: `${error.status}: ${error.message}` }
        if (error.details) {
            payload.details = error.details
        }
        return res.status(error.status).json(payload)
    }

    return next(error)
}

const createAdminRouter = (dependencies) => {
    const {
        client,
        webSocket,
        requireCsrfToken,
        getAccessToken,
        ensureCsrfToken,
        healthChecks = {},
        discordApi,
        clientCredentials,
        getInviteRedirectUri,
        statusService,
        adminService
    } = dependencies

    const router = express.Router()

    const resolvedAdminService = adminService || createAdminServiceFactory({
        client,
        webSocket,
        statusService,
        healthChecks,
        discordApi,
        clientCredentials,
        getInviteRedirectUri,
        logger
    })

    const ensureAuthenticated = (req, res) => {
        if (!getAccessToken(req)) {
            res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
            return false
        }
        return true
    }

    const ensurePanelAdmin = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canAccessPanel) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        return true
    }

    const ensureLogsAccess = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canViewLogs) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        return true
    }

    const auditAdminAction = (req, action, meta = {}) => {
        logger.info("Admin action executed", {
            scope: "admin-audit",
            action,
            actorId: req.user?.id || null,
            actorRole: req.user?.role || null,
            guildId: meta.guildId || null,
            tableId: meta.tableId || null,
            targetId: meta.targetId || null
        })
    }

    const handleGetStatus = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await resolvedAdminService.getStatus({ reason: "admin:get-status", actor: req.user?.id })
            res.status(200).json(status)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    }

    const handleBotStateChange = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { enabled } = req.body || {}
        if (typeof enabled !== "boolean") {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const status = await resolvedAdminService.setBotEnabled(enabled, { actor: req.user?.id, reason: "admin:toggle" })
            auditAdminAction(req, enabled ? "bot-enable" : "bot-disable")
            return res.status(200).json(status)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    const handleGetClient = (req, res) => {
        if (!ensurePanelAdmin(req, res)) return
        const csrfToken = ensureCsrfToken(req)
        const payload = resolvedAdminService.getClientConfig()
        if (csrfToken) {
            payload.csrfToken = csrfToken
        }
        res.status(200).json(payload)
    }

    const handleGetGuild = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const guildId = req.query?.id
        if (!guildId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const guild = await resolvedAdminService.getGuild(guildId)
            return res.status(200).json(guild)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    const handleTurnOff = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await resolvedAdminService.setBotEnabled(false, { actor: req.user?.id, reason: "admin:turnoff" })
            auditAdminAction(req, "bot-turnoff")
            res.status(200).json({ message: "200: OK", status })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    }

    const handleTurnOn = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await resolvedAdminService.setBotEnabled(true, { actor: req.user?.id, reason: "admin:turnon" })
            auditAdminAction(req, "bot-turnon")
            res.status(200).json({ message: "200: OK", status })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    }

    router.get("/status", adminReadLimiter, handleGetStatus)
    router.patch(
        "/bot",
        criticalActionLimiter,
        validate(adminSchemas.toggleBot, "body"),
        requireCsrfToken,
        handleBotStateChange
    )
    router.get("/client", adminReadLimiter, handleGetClient)
    router.get("/guild", adminReadLimiter, handleGetGuild)
    router.post("/turnoff", criticalActionLimiter, requireCsrfToken, handleTurnOff)
    router.post("/turnon", criticalActionLimiter, requireCsrfToken, handleTurnOn)

    router.get("/tables", adminReadLimiter, async(req, res, next) => {
        if (!ensureLogsAccess(req, res)) return
        try {
            const payload = resolvedAdminService.listTables()
            res.status(200).json(payload)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.post(
        "/tables/:tableId/actions",
        adminWriteLimiter,
        validate(adminSchemas.tableActionParams, "params"),
        validate(adminSchemas.tableAction, "body"),
        requireCsrfToken,
        async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const tableId = req.params?.tableId
        const action = req.body?.action
        try {
            const result = await resolvedAdminService.controlTable({
                tableId,
                action,
                actor: {
                    id: req.user?.id,
                    tag: req.user?.username || req.user?.tag || null,
                    label: req.user?.username || null
                }
            })
            auditAdminAction(req, `table:${action}`, { tableId })
            res.status(200).json(result)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.post(
        "/guild/leave",
        adminWriteLimiter,
        validate(adminSchemas.leaveGuild, "body"),
        requireCsrfToken,
        async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { id: guildId } = req.body
        try {
            await resolvedAdminService.leaveGuild(guildId, { actor: req.user?.id })
            auditAdminAction(req, "guild-leave", { guildId })
            return res.status(200).json({ message: "200: OK" })
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    })

    router.post(
        "/guild/invite/complete",
        adminWriteLimiter,
        validate(adminSchemas.completeInvite, "body"),
        requireCsrfToken,
        async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { code, guildId } = req.body

        try {
            const status = await resolvedAdminService.completeInvite({ code, guildId, meta: { actor: req.user?.id } })
            auditAdminAction(req, "guild-invite-complete", { guildId })
            res.status(200).json({ status })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    const handleExecuteAction = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const actionId = req.params?.actionId || req.body?.actionId
        if (!actionId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const result = await resolvedAdminService.executeAction(actionId, {
                actor: req.user?.id,
                reason: `admin:${actionId}`
            })
            auditAdminAction(req, `remote-action:${actionId}`)
            return res.status(200).json(result)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    router.get("/actions", adminReadLimiter, (req, res) => {
        if (!ensurePanelAdmin(req, res)) return
        res.status(200).json(resolvedAdminService.listActions())
    })
    router.post("/actions/:actionId", adminWriteLimiter, requireCsrfToken, handleExecuteAction)

    router.post("/kill", criticalActionLimiter, requireCsrfToken, async(req, res) => {
        if (!ensurePanelAdmin(req, res)) return

        res.status(200).json({ message: "200: Bot process terminating" })

        logger.warn("Bot process kill requested by admin", {
            scope: "admin",
            userId: req.user?.id
        })
        auditAdminAction(req, "bot-kill")

        setTimeout(() => {
            process.exit(0)
        }, 1000)
    })

    router.post(
        "/logs",
        logWriteLimiter,
        validate(adminSchemas.createLog, "body"),
        requireCsrfToken,
        async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { level, message, logType, userId } = req.body
        if (!req.permissions?.canWriteLogs) {
            return res.status(403).json({ message: "403: Forbidden" })
        }

        try {
            await resolvedAdminService.createLog({ level, message, logType, userId })
            auditAdminAction(req, "log-create", { targetId: userId })
            res.status(201).json({ message: "201: Log saved" })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.get("/logs", adminReadLimiter, validate(adminSchemas.getLogs, "query"), async(req, res, next) => {
        if (!ensureLogsAccess(req, res)) return
        const { type: logType, limit, cursor } = req.query

        try {
            const result = await resolvedAdminService.getLogs({ logType, limit, cursor })
            res.status(200).json(result)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.delete("/logs/cleanup", adminWriteLimiter, requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return

        try {
            const result = await resolvedAdminService.cleanupLogs()
            auditAdminAction(req, "log-cleanup")
            res.status(200).json(result)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    return {
        router,
        handlers: {
            getStatus: handleGetStatus,
            patchBot: handleBotStateChange,
            getClient: handleGetClient,
            getGuild: handleGetGuild,
            turnOff: handleTurnOff,
            turnOn: handleTurnOn
        }
    }
}

module.exports = createAdminRouter
