const { EmbedBuilder, Colors } = require("discord.js")
const { getActiveGames } = require("../../bot/utils/gameRegistry")
const { analyzeQuery } = require("../../bot/utils/db/queryAnalyzer")
const { logger: defaultLogger } = require("../middleware/structuredLogger")

const createHttpError = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
}

const ACTION_IDS = {
    SYNC_COMMANDS: "bot-sync-commands"
}

const createAdminService = ({
    client,
    webSocket,
    statusService,
    healthChecks = {},
    discordApi,
    clientCredentials,
    getInviteRedirectUri,
    logger = defaultLogger
}) => {
    if (!client) {
        throw new Error("Discord client is required to create the admin service")
    }

    const encodeCursor = (row) => {
        if (!row) return null
        const createdAt = row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString()
        const payload = { id: row.id, createdAt }
        return Buffer.from(JSON.stringify(payload)).toString("base64")
    }

    const decodeCursor = (cursor) => {
        if (!cursor) return null
        try {
            const decoded = Buffer.from(cursor, "base64").toString("utf8")
            const payload = JSON.parse(decoded)
            if (!payload || !payload.id || !payload.createdAt) {
                return null
            }
            const createdAtDate = new Date(payload.createdAt)
            const id = Number(payload.id)
            if (Number.isNaN(createdAtDate.getTime()) || Number.isNaN(id)) {
                return null
            }
            return { id, createdAt: createdAtDate }
        } catch (error) {
            return null
        }
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

    const toGuildPayload = (guild) => {
        if (!guild) return null
        if (typeof guild.toJSON === "function") {
            return guild.toJSON()
        }

        return {
            id: guild.id,
            name: guild.name,
            description: guild.description || null
        }
    }

    const statusLayer = {
        getStatus: async(options) => {
            if (statusService?.getBotStatus) {
                return statusService.getBotStatus(options)
            }
            return buildBotStatus()
        },
        refreshStatus: async(options) => {
            if (statusService?.refreshBotStatus) {
                return statusService.refreshBotStatus(options)
            }
            return buildBotStatus()
        },
        getGuild: async(guildId, options) => {
            if (statusService?.getGuildSnapshot) {
                return statusService.getGuildSnapshot(guildId, options)
            }
            const guild = client.guilds?.cache?.get?.(guildId)
            return toGuildPayload(guild)
        },
        invalidateGuild: async(guildId) => {
            if (statusService?.invalidateGuildSnapshot) {
                await statusService.invalidateGuildSnapshot(guildId)
            }
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
                                    .setDescription("⚠️ This table was stopped because Chipsy was disabled by the admins.")
                            ]
                        }).catch((error) => {
                            logger.warn("Failed to notify channel about forced game stop", {
                                scope: "admin",
                                channelId: game.channel?.id,
                                game: game.constructor?.name,
                                err: error?.message
                            })
                            return null
                        })
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

    const setBotEnabled = async(enabled, meta = {}) => {
        if (botStateChangePending) {
            throw createHttpError(409, "Bot state change already in progress")
        }

        const wasEnabled = Boolean(client.config?.enabled)
        const willBeEnabled = Boolean(enabled)

        if (wasEnabled === willBeEnabled) {
            return statusLayer.getStatus({ reason: "no-op", ...meta })
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

        return statusLayer.refreshStatus({
            reason: meta.reason || (willBeEnabled ? "enable" : "disable"),
            ...meta,
            enabled: willBeEnabled
        })
    }

    const getStatus = async(meta = {}) => statusLayer.getStatus(meta)

    const getClientConfig = () => ({
        id: client.config?.id,
        ownerid: client.config?.ownerid,
        prefix: client.config?.prefix,
        enabled: Boolean(client.config?.enabled),
        redirectUri: client.config?.redirectUri
    })

    const getGuild = async(guildId) => {
        const guild = await statusLayer.getGuild(guildId)
        if (!guild) {
            throw createHttpError(404, "Guild not found")
        }
        return guild
    }

    const leaveGuild = async(guildId, meta = {}) => {
        const guild = client.guilds?.cache?.get?.(guildId)
        if (!guild) {
            throw createHttpError(404, "Guild not found")
        }

        await guild.leave()
        await statusLayer.invalidateGuild(guildId)
        await statusLayer.refreshStatus({ reason: "admin:guild-leave", ...meta })
    }

    const completeInvite = async({ code, guildId, meta = {} }) => {
        if (!discordApi || !clientCredentials || typeof getInviteRedirectUri !== "function") {
            throw createHttpError(500, "Invite completion unavailable")
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
            const failure = createHttpError(502, "Unable to finalize bot invitation")
            failure.details = details
            throw failure
        }

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

        if (guildId) {
            await statusLayer.invalidateGuild(guildId)
        }

        return statusLayer.refreshStatus({ reason: "admin:invite-complete", guildId, ...meta })
    }

    const getCommandRegistry = () => {
        const registry = client?.commandRegistry
        if (!registry || typeof registry.reloadAll !== "function") {
            return null
        }
        return registry
    }

    const requireCommandRegistry = () => {
        const registry = getCommandRegistry()
        if (!registry) {
            throw createHttpError(503, "Command registry unavailable")
        }
        return registry
    }

    const listActions = () => ({
        actions: [
            {
                id: ACTION_IDS.SYNC_COMMANDS,
                label: "Sincronizza comandi slash",
                description: "Ricarica le definizioni locali e aggiorna Discord senza riavviare il bot.",
                type: getCommandRegistry() ? "command" : "concept",
                badge: getCommandRegistry() ? "Live" : "Idea",
                pendingLabel: getCommandRegistry() ? undefined : "In attesa di registro comandi",
                confirmation: {
                    stepOne: "Questo avvierà un reload soft delle definizioni dei comandi.",
                    stepTwo: "Assicurati che gli slash command stiano funzionando prima di proseguire."
                }
            },
            {
                id: "bot-reload-config",
                label: "Ricarica configurazioni",
                description: "Applica da remoto le nuove impostazioni senza riavviare il processo.",
                type: "concept",
                badge: "Idea",
                pendingLabel: "In progettazione"
            },
            {
                id: "bot-diagnostics",
                label: "Esegui diagnostica servizi",
                description: "Avvia una scansione rapida di database e integrazioni esterne per verificarne lo stato.",
                type: "concept",
                badge: "Idea"
            }
        ]
    })

    const requireConnection = () => {
        const connection = client?.connection
        if (!connection) {
            throw createHttpError(500, "Database connection unavailable")
        }
        return connection
    }

    const createLog = async({ level, message, logType, userId }) => {
        const connection = requireConnection()
        await connection.query(
            "INSERT INTO logs (level, message, log_type, user_id) VALUES (?, ?, ?, ?)",
            [level, message, logType, userId]
        )
    }

    const getLogs = async({ logType, limit, cursor }) => {
        const connection = requireConnection()
        const pageLimit = Number(limit) || 100
        const decodedCursor = decodeCursor(cursor)

        if (cursor && !decodedCursor) {
            throw createHttpError(400, "Invalid cursor")
        }

        const cursorClause = decodedCursor
            ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
            : ""

        const query = `
            SELECT id, level, message, log_type, user_id, created_at
            FROM logs
            WHERE log_type = ?
            ${cursorClause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
        `

        const params = decodedCursor
            ? [logType, decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id, pageLimit + 1]
            : [logType, pageLimit + 1]

        await analyzeQuery(connection, query, params, { label: "admin:get-logs" })

        const [rows] = await connection.query(query, params)
        const hasNext = rows.length > pageLimit
        const limitedRows = rows.slice(0, pageLimit)
        const nextCursor = hasNext && limitedRows.length > 0
            ? encodeCursor(limitedRows[limitedRows.length - 1])
            : null
        const responseLogs = limitedRows.slice().reverse()

        return {
            logs: responseLogs,
            nextCursor,
            pageInfo: {
                hasNext,
                nextCursor,
                limit: pageLimit,
                cursor: nextCursor
            }
        }
    }

    const cleanupLogs = async() => {
        const connection = requireConnection()
        const [result] = await connection.query(
            "DELETE FROM logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 5 DAY)"
        )

        return {
            message: "200: Logs cleaned up",
            deletedCount: result.affectedRows
        }
    }

    const executeAction = async(actionId, meta = {}) => {
        if (!actionId) {
            throw createHttpError(400, "Missing action id")
        }

        switch (actionId) {
            case ACTION_IDS.SYNC_COMMANDS: {
                const registry = requireCommandRegistry()
                const startedAt = Date.now()
                const reason = meta.reason || "admin:sync-commands"

                logger.info("Admin requested slash command reload", {
                    scope: "admin",
                    actionId,
                    actor: meta.actor || "unknown"
                })

                try {
                    const stats = await registry.reloadAll({ reason, sync: true })
                    const duration = Date.now() - startedAt
                    return {
                        actionId,
                        status: "ok",
                        message: "Slash commands reloaded and synchronized.",
                        stats,
                        syncedAt: stats?.lastSyncAt ?? registry.lastSyncAt,
                        durationMs: duration
                    }
                } catch (error) {
                    logger.error("Slash command reload failed", {
                        scope: "admin",
                        actionId,
                        error: error?.message,
                        details: error?.details
                    })
                    const failure = createHttpError(500, "Unable to reload slash commands")
                    if (error?.details) {
                        failure.details = error.details
                    }
                    throw failure
                }
            }
            default:
                throw createHttpError(404, "Action not found")
        }
    }

    return {
        getStatus,
        setBotEnabled,
        getClientConfig,
        getGuild,
        leaveGuild,
        completeInvite,
        listActions,
        executeAction,
        createLog,
        getLogs,
        cleanupLogs
    }
}

module.exports = createAdminService
