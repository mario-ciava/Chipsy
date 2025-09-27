const express = require("express")
const createAdminService = require("../services/adminService")
const { logger } = require("../middleware/structuredLogger")
const { constants } = require("../../config")

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
        statusService
    } = dependencies

    const router = express.Router()

    const adminService = createAdminService({
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

    const handleGetStatus = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await adminService.getStatus({ reason: "admin:get-status", actor: req.user?.id })
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
            const status = await adminService.setBotEnabled(enabled, { actor: req.user?.id, reason: "admin:toggle" })
            return res.status(200).json(status)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    const handleGetClient = (req, res) => {
        if (!ensurePanelAdmin(req, res)) return
        const csrfToken = ensureCsrfToken(req)
        const payload = adminService.getClientConfig()
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
            const guild = await adminService.getGuild(guildId)
            return res.status(200).json(guild)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    const handleTurnOff = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await adminService.setBotEnabled(false, { actor: req.user?.id, reason: "admin:turnoff" })
            res.status(200).json({ message: "200: OK", status })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    }

    const handleTurnOn = async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        try {
            const status = await adminService.setBotEnabled(true, { actor: req.user?.id, reason: "admin:turnon" })
            res.status(200).json({ message: "200: OK", status })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    }

    router.get("/status", handleGetStatus)
    router.patch("/bot", requireCsrfToken, handleBotStateChange)
    router.get("/client", handleGetClient)
    router.get("/guild", handleGetGuild)
    router.post("/turnoff", requireCsrfToken, handleTurnOff)
    router.post("/turnon", requireCsrfToken, handleTurnOn)

    router.get("/tables", async(req, res, next) => {
        if (!ensureLogsAccess(req, res)) return
        try {
            const payload = adminService.listTables()
            res.status(200).json(payload)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.post("/tables/:tableId/actions", requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const tableId = req.params?.tableId
        const action = req.body?.action
        try {
            const result = await adminService.controlTable({
                tableId,
                action,
                actor: {
                    id: req.user?.id,
                    tag: req.user?.username || req.user?.tag || null,
                    label: req.user?.username || null
                }
            })
            res.status(200).json(result)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.post("/guild/leave", requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { id: guildId } = req.body
        try {
            await adminService.leaveGuild(guildId, { actor: req.user?.id })
            return res.status(200).json({ message: "200: OK" })
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    })

    router.post("/guild/invite/complete", requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { code, guildId } = req.body

        try {
            const status = await adminService.completeInvite({ code, guildId, meta: { actor: req.user?.id } })
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
            const result = await adminService.executeAction(actionId, {
                actor: req.user?.id,
                reason: `admin:${actionId}`
            })
            return res.status(200).json(result)
        } catch (error) {
            return respondWithServiceError(error, res, next)
        }
    }

    router.get("/actions", (req, res) => {
        if (!ensurePanelAdmin(req, res)) return
        res.status(200).json(adminService.listActions())
    })
    router.post("/actions/:actionId", requireCsrfToken, handleExecuteAction)

    router.post("/kill", requireCsrfToken, async(req, res) => {
        if (!ensurePanelAdmin(req, res)) return

        res.status(200).json({ message: "200: Bot process terminating" })

        logger.warn("Bot process kill requested by admin", {
            scope: "admin",
            userId: req.user?.id
        })

        setTimeout(() => {
            process.exit(0)
        }, 1000)
    })

    router.post("/logs", requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return
        const { level, message, logType, userId } = req.body
        if (!req.permissions?.canWriteLogs) {
            return res.status(403).json({ message: "403: Forbidden" })
        }

        try {
            await adminService.createLog({ level, message, logType, userId })
            res.status(201).json({ message: "201: Log saved" })
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.get("/logs", async(req, res, next) => {
        if (!ensureLogsAccess(req, res)) return
        const { type: logType, limit, cursor } = req.query

        try {
            const result = await adminService.getLogs({ logType, limit, cursor })
            res.status(200).json(result)
        } catch (error) {
            respondWithServiceError(error, res, next)
        }
    })

    router.delete("/logs/cleanup", requireCsrfToken, async(req, res, next) => {
        if (!ensurePanelAdmin(req, res)) return

        try {
            const result = await adminService.cleanupLogs()
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
