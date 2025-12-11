const logger = require("../../../shared/logger")

const DEFAULT_TRUNCATION = 120

const truncate = (value, max = DEFAULT_TRUNCATION) => {
    if (value == null) return null
    const str = String(value)
    if (str.length <= max) return str
    return `${str.slice(0, max - 3)}...`
}

const sanitizeWhitespace = (value) => {
    if (!value) return ""
    return String(value).replace(/\s+/g, " ").trim()
}

const buildUserLabel = ({ userTag, userId }) => {
    if (userTag && userId) {
        return `${truncate(userTag, 72)} (${userId})`
    }
    if (userId) return userId
    return "unknown user"
}

const buildCommandLabel = (commandPath) => {
    if (!commandPath) return "/unknown"
    return `/${commandPath}`.replace(/\s+/g, " ").trim()
}

const buildLocationLabel = ({ guildName, guildId, channelName, channelId }) => {
    const parts = []
    if (guildName || guildId) {
        parts.push(guildName ? truncate(guildName, 64) : `Guild ${guildId}`)
    }
    if (channelName || channelId) {
        parts.push(channelName ? `#${truncate(channelName, 64)}` : `Channel ${channelId}`)
    }
    if (!parts.length) {
        return "DM"
    }
    return parts.join(" / ")
}

const buildLogMessage = ({
    commandPath,
    userTag,
    userId,
    guildName,
    guildId,
    channelName,
    channelId,
    status,
    durationMs,
    errorMessage
}) => {
    const commandLabel = buildCommandLabel(commandPath)
    const userLabel = buildUserLabel({ userTag, userId })
    const locationLabel = buildLocationLabel({ guildName, guildId, channelName, channelId })
    const parts = [
        `${commandLabel} by ${userLabel}`,
        `in ${locationLabel}`,
        "—",
        status === "error" ? "failed" : "completed"
    ]

    if (status === "error" && errorMessage) {
        parts.push(`(${truncate(errorMessage, 140)})`)
    }

    if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
        const rounded = Math.max(0, Math.round(durationMs))
        parts.push(`in ${rounded}ms`)
    }

    return sanitizeWhitespace(parts.join(" "))
}

const createCommandUsageLogger = ({ pool, logger: injectedLogger = logger } = {}) => {
    if (!pool || typeof pool.query !== "function") {
        throw new Error("A MySQL pool is required to create the command usage logger")
    }

    const log = injectedLogger

    const persistLog = async({ level, message, userId }) => {
        if (!message) return
        try {
            await pool.query(
                "INSERT INTO `logs` (`level`, `message`, `log_type`, `user_id`) VALUES (?, ?, 'command', ?)",
                [level, message, userId || null]
            )
        } catch (error) {
            log.warn("Failed to persist command usage log", {
                scope: "commandLogger",
                level,
                userId,
                message: error.message
            })
        }
    }

    const recordInteraction = async(payload = {}) => {
        const {
            commandPath,
            userTag,
            userId,
            guildName,
            guildId,
            channelName,
            channelId,
            status,
            durationMs,
            errorMessage
        } = payload

        const level = status === "error" ? "error" : "info"
        const message = buildLogMessage({
            commandPath,
            userTag,
            userId,
            guildName,
            guildId,
            channelName,
            channelId,
            status,
            durationMs,
            errorMessage
        })

        await persistLog({ level, message, userId })
    }

    return {
        recordInteraction
    }
}

module.exports = createCommandUsageLogger
