const logger = require("../utils/logger")

const DEFAULT_EXPIRY_MS = 30 * 60 * 1000

const hasPool = (pool) => pool && typeof pool.query === "function"

const normalizeDate = (value) => {
    if (value instanceof Date) return value
    const date = value ? new Date(value) : null
    return Number.isFinite(date?.getTime()) ? date : new Date(Date.now() + DEFAULT_EXPIRY_MS)
}

const logError = (message, meta = {}) => {
    if (!logger || typeof logger.error !== "function") return
    logger.error(message, { scope: "publicLobbyRegistry", ...meta })
}

const registerPublicLobby = async(pool, lobby = {}) => {
    if (!hasPool(pool)) return null
    const {
        id,
        game,
        guildId,
        channelId,
        messageId = null,
        hostId,
        hostName = null,
        minBet,
        maxPlayers,
        currentPlayers = 1,
        status = "waiting",
        expiresAt = null,
        ttl = null
    } = lobby

    if (!id || !game || !guildId || !channelId || !hostId) {
        return null
    }
    if (!Number.isFinite(minBet) || !Number.isFinite(maxPlayers)) {
        return null
    }

    let expirySql = "?"
    let expiryParam = expiresAt === null ? null : normalizeDate(expiresAt)

    if (Number.isFinite(ttl) && ttl > 0) {
        expirySql = "DATE_ADD(NOW(), INTERVAL ? SECOND)"
        expiryParam = Math.floor(ttl)
    }

    try {
        await pool.query(
            `REPLACE INTO \`public_lobbies\`
                (\`id\`, \`game\`, \`guild_id\`, \`channel_id\`, \`message_id\`, \`host_id\`, \`host_name\`, \`min_bet\`, \`max_players\`, \`current_players\`, \`status\`, \`expires_at\`)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${expirySql})`,
            [
                id,
                game,
                guildId,
                channelId,
                messageId,
                hostId,
                hostName,
                minBet,
                maxPlayers,
                Math.max(0, currentPlayers || 0),
                status,
                expiryParam
            ]
        )
        return id
    } catch (error) {
        logError("Failed to register public lobby", { error: error.message, id, game, channelId })
        return null
    }
}

const unregisterPublicLobby = async(pool, lobbyId) => {
    if (!hasPool(pool) || !lobbyId) return null
    try {
        const [result] = await pool.query("DELETE FROM `public_lobbies` WHERE `id` = ?", [lobbyId])
        return result?.affectedRows ?? 0
    } catch (error) {
        logError("Failed to unregister public lobby", { error: error.message, lobbyId })
        return null
    }
}

const updateLobbyPlayerCount = async(pool, lobbyId, count = 0) => {
    if (!hasPool(pool) || !lobbyId) return null
    const safeCount = Math.max(0, Number(count) || 0)
    try {
        const [result] = await pool.query(
            "UPDATE `public_lobbies` SET `current_players` = ? WHERE `id` = ?",
            [safeCount, lobbyId]
        )
        return result?.affectedRows ?? 0
    } catch (error) {
        logError("Failed to update public lobby player count", { error: error.message, lobbyId })
        return null
    }
}

const findPublicLobbies = async({ pool, game, limit = 25, status = "waiting" }) => {
    if (!hasPool(pool)) return []
    const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 50))
    try {
        const [rows] = await pool.query(
            `SELECT * FROM \`public_lobbies\`
            WHERE \`status\` = ? AND \`game\` = ? AND (\`expires_at\` IS NULL OR \`expires_at\` > NOW())
            ORDER BY \`min_bet\` ASC, \`created_at\` ASC
            LIMIT ?`,
            [status, game, safeLimit]
        )
        return rows || []
    } catch (error) {
        logError("Failed to find public lobbies", { error: error.message, game, status })
        return []
    }
}

const cleanupExpiredLobbies = async(pool) => {
    if (!hasPool(pool)) return 0
    try {
        const [result] = await pool.query(
            "DELETE FROM `public_lobbies` WHERE `expires_at` IS NOT NULL AND `expires_at` <= NOW()"
        )
        return result?.affectedRows ?? 0
    } catch (error) {
        logError("Failed to cleanup expired public lobbies", { error: error.message })
        return 0
    }
}

const countUserPublicLobbies = async(pool, hostId) => {
    if (!hasPool(pool) || !hostId) return 0
    try {
        const [rows] = await pool.query(
            "SELECT COUNT(*) as count FROM `public_lobbies` WHERE `host_id` = ? AND (`expires_at` IS NULL OR \`expires_at\` > NOW())",
            [hostId]
        )
        return rows?.[0]?.count ?? 0
    } catch (error) {
        logError("Failed to count user public lobbies", { error: error.message, hostId })
        return 0
    }
}

module.exports = {
    registerPublicLobby,
    unregisterPublicLobby,
    updateLobbyPlayerCount,
    findPublicLobbies,
    cleanupExpiredLobbies,
    countUserPublicLobbies
}
