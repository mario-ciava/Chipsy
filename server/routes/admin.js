const express = require("express")

const createAdminRouter = (dependencies) => {
    const {
        client,
        webSocket,
        requireCsrfToken,
        getAccessToken,
        ensureCsrfToken,
        healthChecks = {}
    } = dependencies

    const router = express.Router()

    const ensureAuthenticatedAdmin = (req, res) => {
        if (!getAccessToken(req)) {
            res.status(400).json({ message: "400: Bad request" })
            return false
        }
        if (!req.isAdmin) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        return true
    }

    const buildBotStatus = async() => {
        const guildCount = client.guilds?.cache?.size ?? 0
        const health = {}

        if (typeof healthChecks.mysql === "function") {
            try {
                health.mysql = await healthChecks.mysql()
            } catch (error) {
                health.mysql = { alive: false, error: error.message }
            }
        }

        return {
            enabled: Boolean(client.config?.enabled),
            guildCount,
            updatedAt: new Date().toISOString(),
            health
        }
    }

    const setBotEnabled = (enabled) => {
        client.config.enabled = Boolean(enabled)
        if (enabled) {
            webSocket?.emit("enable")
        } else {
            webSocket?.emit("disable")
        }
    }

    const handleGetStatus = async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        const status = await buildBotStatus()
        res.status(200).json(status)
    }

    const handleBotStateChange = async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        const { enabled } = req.body || {}
        if (typeof enabled !== "boolean") {
            return res.status(400).json({ message: "400: Bad request" })
        }
        setBotEnabled(enabled)
        const status = await buildBotStatus()
        return res.status(200).json(status)
    }

    const buildClientConfig = () => ({
        id: client.config?.id,
        ownerid: client.config?.ownerid,
        prefix: client.config?.prefix,
        enabled: Boolean(client.config?.enabled),
        redirectUri: client.config?.redirectUri
    })

    const handleGetClient = (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        const csrfToken = ensureCsrfToken(req)
        const payload = buildClientConfig()
        if (csrfToken) {
            payload.csrfToken = csrfToken
        }
        res.status(200).json(payload)
    }

    const handleGetGuild = (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
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

    const handleTurnOff = (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        setBotEnabled(false)
        res.status(200).json({ message: "200: OK" })
    }

    const handleTurnOn = (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        setBotEnabled(true)
        res.status(200).json({ message: "200: OK" })
    }

    router.get("/status", handleGetStatus)
    router.patch("/bot", requireCsrfToken, handleBotStateChange)
    router.get("/client", handleGetClient)
    router.get("/guild", handleGetGuild)
    router.post("/turnoff", requireCsrfToken, handleTurnOff)
    router.post("/turnon", requireCsrfToken, handleTurnOn)
    router.post("/guild/leave", requireCsrfToken, async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        const guildId = req.body?.id

        if (!guildId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        const guild = client.guilds?.cache?.get?.(guildId)
        if (!guild) {
            return res.status(404).json({ message: "404: Guild not found" })
        }

        try {
            await guild.leave()
            return res.status(200).json({ message: "200: OK" })
        } catch (error) {
            if (client?.logger?.error) {
                client.logger.error("Failed to leave guild", {
                    scope: "express",
                    guildId,
                    message: error.message
                })
            }
            return res.status(500).json({ message: "500: Unable to leave the guild" })
        }
    })
    router.get("/actions", (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        res.status(200).json({
            actions: [
                {
                    id: "bot-toggle",
                    label: "Toggle bot availability",
                    description: "Enable or disable the bot instance.",
                    type: "toggle",
                    supports: ["enable", "disable"]
                }
            ]
        })
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
