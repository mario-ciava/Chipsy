const { EmbedBuilder, Colors } = require("discord.js")
const { getActiveGames } = require("../../bot/utils/gameRegistry")
const { analyzeQuery } = require("../../bot/utils/db/queryAnalyzer")
const { logger: defaultLogger } = require("../middleware/structuredLogger")
const runtimeConfig = require("../../config")
const createRuntimeConfigService = require("./runtimeConfigService")
const createDiagnosticsService = require("./diagnosticsService")

const createHttpError = (status, message) => {
    const error = new Error(message)
    error.status = status
    return error
}

const formatTypeLabel = (name = "Game") => {
    const withoutSuffix = name.replace(/Game$/i, "")
    return withoutSuffix
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
        || "Table"
}

const ACTION_IDS = {
    SYNC_COMMANDS: "bot-sync-commands",
    RELOAD_CONFIG: "bot-reload-config",
    RUN_DIAGNOSTICS: "bot-diagnostics"
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

    const runtimeConfigService = createRuntimeConfigService({ client, logger })
    const diagnosticsService = createDiagnosticsService({
        client,
        cache: client.cache,
        healthChecks,
        statusService,
        logger
    })

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

    const collectActiveGames = () => {
        const trackedGames = new Set(getActiveGames(client))
        const channels = client?.channels?.cache
        if (channels) {
            for (const channel of channels.values()) {
                const game = channel?.game
                if (game) {
                    trackedGames.add(game)
                }
            }
        }
        return Array.from(trackedGames)
    }

    const findGameByTableId = (tableId) => {
        if (!tableId) return null
        return collectActiveGames().find((game) => {
            const remote = typeof game.getRemoteState === "function"
                ? game.getRemoteState()
                : (game.remoteControl || {})
            if (remote?.id === tableId) {
                return true
            }
            return false
        }) || null
    }

    const formatPlayerTag = (player, index = 0) => {
        if (!player) return `Seat ${index + 1}`
        return player.tag
            || player.username
            || player.user?.tag
            || (typeof player.toString === "function" ? player.toString() : null)
            || `Seat ${index + 1}`
    }

    const derivePlayerState = (player = {}) => {
        const status = player.status || {}
        if (status.removed) return "removed"
        if (status.folded) return "folded"
        if (status.allIn) return "all-in"
        if (status.current) return "acting"
        if (Array.isArray(player.hands) && player.hands.some((hand) => hand?.busted)) {
            return "busted"
        }
        if (status.out) return "out"
        return "active"
    }

    const derivePhase = (game, type) => {
        if (!game) return null
        if (type === "texas") {
            const cards = Array.isArray(game.tableCards) ? game.tableCards.length : 0
            if (cards === 0) return "pre-flop"
            if (cards === 3) return "flop"
            if (cards === 4) return "turn"
            if (cards >= 5) return "river"
            return "dealing"
        }
        if (type === "blackjack") {
            if (game.isBettingPhaseOpen) return "betting"
            if (game.dealer?.value) return "dealer"
            return "playing"
        }
        return null
    }

    const computeActions = (game, remoteState = {}) => {
        const canStop = typeof game?.Stop === "function"
        const canStart = typeof game?.Run === "function"
        const canPause = typeof game?.handleRemotePause === "function"
        const canResume = typeof game?.handleRemoteResume === "function"
        return {
            start: !game?.playing && canStart,
            pause: Boolean(game?.playing) && !remoteState.paused && canPause,
            resume: Boolean(remoteState.paused) && canResume,
            stop: canStop
        }
    }

    const buildTableSnapshot = (game) => {
        if (!game) return null
        const remoteState = typeof game.getRemoteState === "function"
            ? game.getRemoteState()
            : (game.remoteControl || {})
        const channel = game.channel
        const guild = channel?.guild
        const typeName = (remoteState.type || game.constructor?.name || "game").replace(/Game$/i, "").toLowerCase()
        const id = remoteState.id || channel?.id
        if (!id) return null

        const players = Array.isArray(game.players)
            ? game.players.map((player, index) => ({
                id: player?.id || null,
                tag: formatPlayerTag(player, index),
                stack: Number.isFinite(player?.stack) ? player.stack : 0,
                bet: player?.bets?.current ?? 0,
                totalBet: player?.bets?.total ?? 0,
                state: derivePlayerState(player),
                isHost: remoteState.host?.id ? remoteState.host.id === player?.id : false
            }))
            : []

        const awaitingId = game.awaitingPlayerId
            || remoteState.awaitingPlayerId
            || remoteState.currentPlayerId
            || null
        const awaitingPlayer = awaitingId
            ? players.find((player) => player.id === awaitingId)
            : null

        const guildPayload = guild
            ? {
                id: guild.id,
                name: guild.name,
                icon: typeof guild.iconURL === "function"
                    ? guild.iconURL({ extension: "png", size: 64 })
                    : null
            }
            : remoteState.guildId
                ? { id: remoteState.guildId, name: remoteState.guildName || null }
                : null

        const channelPayload = channel
            ? {
                id: channel.id,
                name: channel.name,
                mention: typeof channel.toString === "function" ? channel.toString() : null
            }
            : remoteState.channelId
                ? { id: remoteState.channelId, name: remoteState.channelName || null }
                : null

        const status = remoteState.paused
            ? "paused"
            : (game.playing ? "running" : "lobby")

        return {
            id,
            type: typeName,
            label: remoteState.label || formatTypeLabel(game.constructor?.name || "Game"),
            status,
            paused: Boolean(remoteState.paused),
            host: remoteState.host || null,
            guild: guildPayload,
            channel: channelPayload,
            players,
            seats: {
                occupied: players.length,
                total: Number.isFinite(game.maxPlayers) ? game.maxPlayers : null
            },
            awaitingPlayer,
            stats: {
                handsPlayed: Number(game.hands) || 0,
                minBet: Number(game.getTableMinBet?.() ?? game.minBet ?? null),
                maxBuyIn: Number(game.maxBuyIn) || null,
                turnTimeoutMs: remoteState.turnTimeoutMs || game.actionTimeoutMs || null,
                potValue: typeof game.getDisplayedPotValue === "function" ? game.getDisplayedPotValue() : null,
                stage: derivePhase(game, typeName),
                communityCards: Array.isArray(game.tableCards) ? game.tableCards.length : null
            },
            actions: computeActions(game, remoteState),
            meta: {
                createdAt: remoteState.createdAt || null,
                startedAt: remoteState.startedAt || null,
                updatedAt: new Date().toISOString(),
                origin: remoteState.origin || null,
                lobby: game.lobbySession
                    ? {
                        status: game.lobbySession.state?.status || null,
                        closed: game.lobbySession.isClosed
                    }
                    : null,
                pause: remoteState.pauseMeta || null
            }
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
        redirectUri: client.config?.redirectUri,
        panel: runtimeConfig.panel
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

    const listActions = () => {
        const registryAvailable = Boolean(getCommandRegistry())
        return {
            actions: [
                {
                    id: ACTION_IDS.SYNC_COMMANDS,
                    label: "Sync slash commands",
                    description: "Reload local definitions and push them to Discord without restarting the bot.",
                    type: registryAvailable ? "command" : "concept",
                    pendingLabel: registryAvailable ? undefined : "Waiting for command registry",
                    confirmation: {
                        stepOne: "This will trigger a soft reload of the slash command definitions.",
                        stepTwo: "Confirm only if the commands are behaving as expected after the sync."
                    }
                },
                {
                    id: ACTION_IDS.RELOAD_CONFIG,
                    label: "Reload configuration",
                    description: "Read the config file again and refresh services without killing the process.",
                    type: "command",
                    confirmation: {
                        stepOne: "Environment variables will be reloaded. Continue only if the file is up to date.",
                        stepTwo: "The bot keeps running but tokens and permissions might change."
                    }
                },
                {
                    id: ACTION_IDS.RUN_DIAGNOSTICS,
                    label: "Run service diagnostics",
                    description: "Check Discord, MySQL, cache layers, and internal health checks.",
                    type: "command"
                }
            ]
        }
    }

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

    const listActiveTables = () => {
        const tables = collectActiveGames()
            .map((game) => {
                try {
                    return buildTableSnapshot(game)
                } catch (error) {
                    logger.warn("Failed to build table snapshot", {
                        scope: "admin",
                        game: game?.constructor?.name,
                        error: error?.message
                    })
                    return null
                }
            })
            .filter(Boolean)
        const ordered = tables.sort((a, b) => {
            const toTs = (value) => {
                const date = value ? new Date(value) : null
                return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
            }
            return toTs(b?.meta?.startedAt || b?.meta?.createdAt) - toTs(a?.meta?.startedAt || a?.meta?.createdAt)
        })
        return {
            tables: ordered,
            fetchedAt: new Date().toISOString(),
            count: ordered.length
        }
    }

    const controlTable = async({ tableId, action, actor }) => {
        if (!tableId || !action) {
            throw createHttpError(400, "Missing table action parameters")
        }

        const normalizedAction = String(action).toLowerCase()
        const game = findGameByTableId(tableId)
        if (!game) {
            throw createHttpError(404, "Table not found")
        }

        const actorMeta = {
            actor: actor?.id || actor?.actor || null,
            actorTag: actor?.tag || actor?.actorTag || null,
            actorLabel: actor?.label || null
        }

        const remoteState = typeof game.getRemoteState === "function"
            ? game.getRemoteState()
            : (game.remoteControl || {})

        const ensureLobbyClosed = async() => {
            if (game.lobbySession && typeof game.lobbySession.close === "function" && !game.lobbySession.isClosed) {
                try {
                    await game.lobbySession.close({ status: "starting", reason: "remote" })
                } catch (error) {
                    logger.warn("Failed to close lobby before remote start", {
                        scope: "admin",
                        channelId: game.channel?.id,
                        error: error?.message
                    })
                }
            }
        }

        const ensureCanPause = () => {
            if (!game.playing) {
                throw createHttpError(409, "Game is not running")
            }
            if (remoteState.paused) {
                throw createHttpError(409, "Game already paused")
            }
            if (typeof game.handleRemotePause !== "function") {
                throw createHttpError(503, "Game cannot be paused remotely")
            }
        }

        const ensureCanResume = () => {
            if (!remoteState.paused) {
                throw createHttpError(409, "Game is not paused")
            }
            if (typeof game.handleRemoteResume !== "function") {
                throw createHttpError(503, "Game cannot resume remotely")
            }
        }

        const ensureCanStart = () => {
            if (game.playing && !remoteState.paused) {
                throw createHttpError(409, "Game already running")
            }
            if (typeof game.Run !== "function") {
                throw createHttpError(503, "Game cannot be started remotely")
            }
            const minPlayers = typeof game.getMinimumPlayers === "function"
                ? game.getMinimumPlayers()
                : 1
            const players = Array.isArray(game.players) ? game.players.length : 0
            if (players < minPlayers) {
                throw createHttpError(409, `At least ${minPlayers} players are required to start`)
            }
        }

        try {
            if (normalizedAction === "pause") {
                ensureCanPause()
                await game.handleRemotePause(actorMeta)
            } else if (normalizedAction === "resume") {
                ensureCanResume()
                await game.handleRemoteResume(actorMeta)
            } else if (normalizedAction === "start") {
                if (remoteState.paused) {
                    ensureCanResume()
                    await game.handleRemoteResume(actorMeta)
                } else {
                    ensureCanStart()
                    await ensureLobbyClosed()
                    await game.Run()
                }
            } else if (normalizedAction === "stop") {
                if (typeof game.Stop !== "function") {
                    throw createHttpError(503, "Game cannot be stopped remotely")
                }
                await game.Stop({ reason: "remoteControl", notify: true })
            } else {
                throw createHttpError(400, "Unsupported table action")
            }
        } catch (error) {
            if (error.status) {
                throw error
            }
            logger.error("Remote table control failed", {
                scope: "admin",
                tableId,
                action: normalizedAction,
                error: error?.message
            })
            throw createHttpError(500, "Unable to execute table action")
        }

        const snapshot = buildTableSnapshot(game)
        return {
            action: normalizedAction,
            status: "ok",
            table: snapshot
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
            case ACTION_IDS.RELOAD_CONFIG: {
                try {
                    const result = await runtimeConfigService.reload({ actor: meta.actor, reason: meta.reason })
                    const changed = result.diff?.total ?? 0
                    const entryWord = changed === 1 ? "voce" : "voci"
                    const adjective = changed === 1 ? "aggiornata" : "aggiornate"
                    return {
                        actionId,
                        status: "ok",
                        message: changed
                            ? `Configurazione ricaricata (${changed} ${entryWord} ${adjective}).`
                            : "Configurazione ricaricata senza differenze rilevate.",
                        diff: result.diff,
                        updatedAt: result.updatedAt
                    }
                } catch (error) {
                    logger.error("Runtime configuration reload failed", {
                        scope: "admin",
                        actionId,
                        error: error?.message
                    })
                    throw createHttpError(500, "Unable to reload configuration")
                }
            }
            case ACTION_IDS.RUN_DIAGNOSTICS: {
                try {
                    const report = await diagnosticsService.run({ actor: meta.actor, reason: meta.reason })
                    return {
                        actionId,
                        status: report.healthy ? "ok" : "degraded",
                        message: report.healthy
                            ? "Diagnostica completata: tutti i servizi rispondono correttamente."
                            : "Diagnostica completata con segnalazioni: controlla il report per i dettagli.",
                        report
                    }
                } catch (error) {
                    logger.error("Diagnostics execution failed", {
                        scope: "admin",
                        actionId,
                        error: error?.message
                    })
                    throw createHttpError(500, "Unable to run diagnostics")
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
        cleanupLogs,
        listTables: listActiveTables,
        controlTable
    }
}

module.exports = createAdminService
