const express = require("express")
const { EmbedBuilder, Colors } = require("discord.js")
const { getActiveGames } = require("../../util/gameRegistry")
const { logger } = require("../middleware/structuredLogger")

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
        getInviteRedirectUri
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

    const stopActiveGames = async({ notify = false } = {}) => {
        const trackedGames = new Set(getActiveGames(client))
        const channels = client?.channels?.cache
        if (channels) {
            for (const channel of channels.values()) {
                const game = channel?.game
                if (game && typeof game.Stop === "function") {
                    trackedGames.add(game)
                }
            }
        }
        if (!trackedGames.size) return

        const stopPromises = Array.from(trackedGames).map(async(game) => {
            if (!game || typeof game.Stop !== "function") return
            try {
                await game.Stop({ notify })
                if (!notify && game.channel && typeof game.channel.send === "function") {
                    if (!game.channel.__chipsyDisabledNotified) {
                        game.channel.__chipsyDisabledNotified = true
                        await game.channel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(Colors.Orange || 0xf97316)
                                    .setDescription("⚠️ La partita è stata interrotta perché Chipsy è stato disattivato dagli amministratori.")
                            ]
                        }).catch(() => null)
                    }
                }
            } catch (error) {
                logger.warn("Failed to stop active game while disabling bot", {
                    scope: "admin",
                    game: game.constructor?.name,
                    channelId: game.channel?.id,
                    error: error.message
                })
            }
        })

        await Promise.allSettled(stopPromises)
    }

    let botStateChangePending = false

    const setBotEnabled = async(enabled) => {
        if (botStateChangePending) {
            throw new Error("A bot state change is already in progress")
        }

        const wasEnabled = Boolean(client.config?.enabled)
        const willBeEnabled = Boolean(enabled)

        if (wasEnabled === willBeEnabled) {
            return
        }

        botStateChangePending = true

        try {
            if (willBeEnabled) {
                client.config.enabled = true
                webSocket?.emit("enable")
                const channels = client?.channels?.cache
                if (channels) {
                    for (const channel of channels.values()) {
                        if (channel && channel.__chipsyDisabledNotified) {
                            delete channel.__chipsyDisabledNotified
                        }
                    }
                }
            } else {
                client.config.enabled = false
                webSocket?.emit("disable")
                await Promise.race([
                    stopActiveGames({ notify: false }),
                    new Promise((resolve) => setTimeout(resolve, 10000))
                ])
            }
        } finally {
            botStateChangePending = false
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
        try {
            await setBotEnabled(enabled)
            const status = await buildBotStatus()
            return res.status(200).json(status)
        } catch (error) {
            if (error.message.includes("already in progress")) {
                return res.status(409).json({ message: "409: Bot state change already in progress" })
            }
            throw error
        }
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

    const handleTurnOff = async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        try {
            await setBotEnabled(false)
            res.status(200).json({ message: "200: OK" })
        } catch (error) {
            if (error.message.includes("already in progress")) {
                return res.status(409).json({ message: "409: Bot state change already in progress" })
            }
            throw error
        }
    }

    const handleTurnOn = async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        try {
            await setBotEnabled(true)
            res.status(200).json({ message: "200: OK" })
        } catch (error) {
            if (error.message.includes("already in progress")) {
                return res.status(409).json({ message: "409: Bot state change already in progress" })
            }
            throw error
        }
    }

    router.get("/status", handleGetStatus)
    router.patch("/bot", requireCsrfToken, handleBotStateChange)
    router.get("/client", handleGetClient)
    router.get("/guild", handleGetGuild)
    router.post("/turnoff", requireCsrfToken, handleTurnOff)
    router.post("/turnon", requireCsrfToken, handleTurnOn)
    router.post("/guild/leave", requireCsrfToken, async(req, res, next) => {
        if (!ensureAuthenticatedAdmin(req, res)) return

        // Validation handled by Zod middleware in adminEnhanced.js
        const { id: guildId } = req.body

        const guild = client.guilds?.cache?.get?.(guildId)
        if (!guild) {
            return res.status(404).json({ message: "404: Guild not found" })
        }

        try {
            await guild.leave()
            return res.status(200).json({ message: "200: OK" })
        } catch (error) {
            logger.error("Failed to leave guild", {
                scope: "admin",
                guildId,
                error: error.message
            })
            next(error)
        }
    })
    router.post("/guild/invite/complete", requireCsrfToken, async(req, res, next) => {
        if (!ensureAuthenticatedAdmin(req, res)) return

        // Validation handled by Zod middleware in adminEnhanced.js
        const { code, guildId } = req.body

        // Verify server dependencies
        if (!discordApi || !clientCredentials || typeof getInviteRedirectUri !== "function") {
            return res.status(500).json({ message: "500: Invite completion unavailable" })
        }

        const redirectUri = getInviteRedirectUri()
        const params = new URLSearchParams({
            client_id: client.config?.id,
            client_secret: client.config?.secret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            scope: "bot applications.commands"
        })

        try {
            await discordApi.post("/oauth2/token", params.toString(), {
                headers: {
                    Authorization: `Basic ${clientCredentials}`,
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            })
        } catch (error) {
            const details = error?.data || error?.response?.data || error?.message
            logger.error("Failed to exchange invite authorization code", {
                scope: "admin",
                error: details
            })
            return res.status(502).json({
                message: "502: Unable to finalize bot invitation",
                details
            })
        }

        // Refresh guild cache if guildId provided
        if (guildId && client?.guilds?.fetch) {
            try {
                await client.guilds.fetch(guildId, { force: true })
            } catch (error) {
                logger.warn("Unable to refresh guild cache after invite completion", {
                    scope: "admin",
                    guildId,
                    error: error.message
                })
            }
        }

        const status = await buildBotStatus()
        res.status(200).json({ status })
    })
    router.get("/actions", (req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return
        res.status(200).json({
            actions: [
                {
                    id: "bot-kill",
                    label: "Termina processo bot",
                    description: "Chiude completamente il processo del bot. Richiede riavvio manuale.",
                    type: "command",
                    dangerous: true
                }
            ]
        })
    })

    router.post("/kill", requireCsrfToken, async(req, res) => {
        if (!ensureAuthenticatedAdmin(req, res)) return

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
        if (!ensureAuthenticatedAdmin(req, res)) return

        // Validation handled by Zod middleware in adminEnhanced.js
        const { level, message, logType, userId } = req.body

        try {
            const connection = client?.connection
            if (!connection) {
                return res.status(500).json({ message: "500: Database connection unavailable" })
            }

            await connection.query(
                "INSERT INTO logs (level, message, log_type, user_id) VALUES (?, ?, ?, ?)",
                [level, message, logType, userId]
            )

            res.status(201).json({ message: "201: Log saved" })
        } catch (error) {
            logger.error("Failed to save log", {
                scope: "admin",
                error: error.message
            })
            // Let global error handler manage unexpected errors
            next(error)
        }
    })

    router.get("/logs", async(req, res, next) => {
        if (!ensureAuthenticatedAdmin(req, res)) return

        // Validation handled by Zod middleware in adminEnhanced.js
        const { type: logType, limit } = req.query

        try {
            const connection = client?.connection
            if (!connection) {
                return res.status(500).json({ message: "500: Database connection unavailable" })
            }

            const [rows] = await connection.query(
                "SELECT id, level, message, log_type, user_id, created_at FROM logs WHERE log_type = ? ORDER BY created_at DESC LIMIT ?",
                [logType, limit]
            )

            res.status(200).json({
                logs: rows.reverse()
            })
        } catch (error) {
            logger.error("Failed to fetch logs", {
                scope: "admin",
                error: error.message
            })
            // Let global error handler manage unexpected errors
            next(error)
        }
    })

    router.delete("/logs/cleanup", requireCsrfToken, async(req, res, next) => {
        if (!ensureAuthenticatedAdmin(req, res)) return

        try {
            const connection = client?.connection
            if (!connection) {
                return res.status(500).json({ message: "500: Database connection unavailable" })
            }

            const [result] = await connection.query(
                "DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 5 DAY)"
            )

            res.status(200).json({
                message: "200: Logs cleaned up",
                deletedCount: result.affectedRows
            })
        } catch (error) {
            logger.error("Failed to cleanup logs", {
                scope: "admin",
                error: error.message
            })
            // Let global error handler manage unexpected errors
            next(error)
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
