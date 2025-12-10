const logger = require("../logger")
const { getGameDefinition, normalizeGameId } = require("./games")

const TABLE_NAME = "game_settings_overrides"
const SUPPORTED_SCOPE_TYPES = new Set(["guild", "channel", "user"])

const normalizeScopeType = (value) => {
    if (!value) return null
    const normalized = String(value).trim().toLowerCase()
    return SUPPORTED_SCOPE_TYPES.has(normalized) ? normalized : null
}

const normalizeScopeId = (value) => {
    if (value === null || value === undefined) return null
    const normalized = String(value).trim()
    if (!normalized) return null
    return normalized.slice(0, 64)
}

const parseStoredValue = (raw) => {
    if (raw === null || raw === undefined) return null
    if (typeof raw === "object") return raw
    if (typeof raw !== "string") return raw
    const trimmed = raw.trim()
    if (!trimmed) return null
    try {
        return JSON.parse(trimmed)
    } catch (_err) {
        return trimmed
    }
}

const resolveGameId = (gameDef, input) => {
    if (gameDef?.gameId) return gameDef.gameId
    if (gameDef?.id) return gameDef.id
    return normalizeGameId(input)
}

const createEmptyResult = () => ({
    guild: {},
    channel: {},
    user: {},
    metadata: {
        guild: {},
        channel: {},
        user: {}
    }
})

const createSettingsStore = ({ pool, logger: providedLogger = logger } = {}) => {
    if (!pool) {
        throw new Error("MySQL pool is required to create the settingsStore")
    }
    const log = providedLogger || console

    const setOverride = async({
        scopeType,
        scopeId,
        game,
        key,
        value,
        actorId = null
    }) => {
        const normalizedScopeType = normalizeScopeType(scopeType)
        if (!normalizedScopeType) {
            throw new Error("Invalid scopeType for settings override")
        }
        const normalizedScopeId = normalizeScopeId(scopeId)
        if (!normalizedScopeId) {
            throw new Error("Invalid scopeId for settings override")
        }

        const gameDef = getGameDefinition(game)
        if (!gameDef) {
            throw new Error(`Unsupported game '${game}' for settings override`)
        }

        if (!gameDef.supportedKeys.includes(key)) {
            throw new Error(`Unsupported key '${key}' for game '${gameDef.gameId}'`)
        }

        const normalized = gameDef.normalizeSetting(key, value)
        if (!normalized?.ok) {
            const reason = normalized?.reason ? ` (${normalized.reason})` : ""
            throw new Error(`Invalid value for '${gameDef.gameId}.${key}'${reason}`)
        }

        const payload = JSON.stringify(normalized.value)
        const gameId = resolveGameId(gameDef, game)

        await pool.query(
            `INSERT INTO \`${TABLE_NAME}\` (\`scope_type\`, \`scope_id\`, \`game\`, \`key\`, \`value\`, \`updated_by\`)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`updated_by\` = VALUES(\`updated_by\`)`,
            [normalizedScopeType, normalizedScopeId, gameId, key, payload, actorId]
        )

        return {
            scopeType: normalizedScopeType,
            scopeId: normalizedScopeId,
            game: gameId,
            key,
            value: normalized.value
        }
    }

    const clearOverride = async({ scopeType, scopeId, game, key }) => {
        const normalizedScopeType = normalizeScopeType(scopeType)
        if (!normalizedScopeType) {
            throw new Error("Invalid scopeType for clearing settings override")
        }
        const normalizedScopeId = normalizeScopeId(scopeId)
        if (!normalizedScopeId) {
            throw new Error("Invalid scopeId for clearing settings override")
        }
        const gameDef = getGameDefinition(game)
        if (!gameDef) {
            throw new Error(`Unsupported game '${game}' for settings override`)
        }
        const gameId = resolveGameId(gameDef, game)

        let sql = `DELETE FROM \`${TABLE_NAME}\` WHERE \`scope_type\` = ? AND \`scope_id\` = ? AND \`game\` = ?`
        const params = [normalizedScopeType, normalizedScopeId, gameId]
        if (key) {
            if (!gameDef.supportedKeys.includes(key)) {
                throw new Error(`Unsupported key '${key}' for game '${gameId}'`)
            }
            sql += " AND `key` = ?"
            params.push(key)
        }

        const [result] = await pool.query(sql, params)
        return { removed: result?.affectedRows || 0 }
    }

    const getOverrides = async({ game, guildId, channelId } = {}) => {
        const gameDef = getGameDefinition(game)
        if (!gameDef) {
            throw new Error(`Unsupported game '${game}' for settings resolution`)
        }
        const result = createEmptyResult()
        const scopes = []

        const normalizedGuildId = normalizeScopeId(guildId)
        if (normalizedGuildId) scopes.push({ type: "guild", id: normalizedGuildId })

        const normalizedChannelId = normalizeScopeId(channelId)
        if (normalizedChannelId) scopes.push({ type: "channel", id: normalizedChannelId })

        if (scopes.length === 0) {
            return result
        }

        const gameId = resolveGameId(gameDef, game)
        const clauses = scopes.map(() => "(`scope_type` = ? AND `scope_id` = ?)")
        const params = [gameId, ...scopes.flatMap((scope) => [scope.type, scope.id])]

        const [rows] = await pool.query(
            `SELECT \`scope_type\`, \`scope_id\`, \`key\`, \`value\`, \`updated_at\`, \`updated_by\`
             FROM \`${TABLE_NAME}\`
             WHERE \`game\` = ? AND (${clauses.join(" OR ")})`,
            params
        )

        for (const row of rows || []) {
            const normalized = gameDef.normalizeSetting(row.key, parseStoredValue(row.value))
            if (!normalized?.ok) {
                log.warn?.("Ignoring invalid settings override", {
                    scope: "settingsStore",
                    game: gameId,
                    key: row.key,
                    reason: normalized?.reason
                })
                continue
            }

            const scopeKey = row.scope_type === "channel"
                ? "channel"
                : row.scope_type === "user"
                    ? "user"
                    : "guild"

            result[scopeKey][row.key] = normalized.value
            result.metadata[scopeKey][row.key] = {
                updatedAt: row.updated_at || null,
                updatedBy: row.updated_by || null
            }
        }

        return result
    }

    return {
        getOverrides,
        setOverride,
        clearOverride
    }
}

module.exports = {
    createSettingsStore
}
