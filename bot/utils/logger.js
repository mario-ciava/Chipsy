const { inspect } = require("util")

const LEVEL_SEVERITY = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4
}

const LEVEL_METHOD = {
    error: "error",
    warn: "warn",
    info: "log",
    debug: "debug",
    verbose: "debug"
}

const LABEL_WIDTH = 7

const ANSI = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    colors: {
        error: "\x1b[31m",
        warn: "\x1b[33m",
        info: "\x1b[36m",
        debug: "\x1b[35m",
        verbose: "\x1b[90m"
    }
}

const normalizeLevel = (level) => {
    if (!level) return "info"
    const lower = String(level).toLowerCase()
    return LEVEL_SEVERITY.hasOwnProperty(lower) ? lower : "info"
}

const shouldUseColor = () => {
    if (process.env.NO_COLOR) return false
    if (process.env.FORCE_COLOR === "0") return false
    if (process.env.FORCE_COLOR) return true
    return Boolean(process.stdout && process.stdout.isTTY)
}

const COLOR_ENABLED = shouldUseColor()

const DEFAULT_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug")
let currentLevel = normalizeLevel(DEFAULT_LEVEL)

const setLevel = (level) => {
    currentLevel = normalizeLevel(level)
}

const getLevel = () => currentLevel

const isLevelEnabled = (level) => {
    const normalized = normalizeLevel(level)
    return LEVEL_SEVERITY[normalized] <= LEVEL_SEVERITY[currentLevel]
}

const applyStyle = (value, level) => {
    if (!COLOR_ENABLED) return value
    const color = ANSI.colors[level] || ""
    return color ? `${color}${value}${ANSI.reset}` : value
}

const dim = (value) => {
    if (!COLOR_ENABLED) return value
    return `${ANSI.dim}${value}${ANSI.reset}`
}

const formatTimestamp = (inputTimestamp) => {
    const date = inputTimestamp instanceof Date ? inputTimestamp : new Date(inputTimestamp || Date.now())
    return date
        .toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        })
}

const sanitizeMetaValue = (value) => {
    if (value === undefined) return undefined
    if (value === null) return "null"
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "bigint") return value.toString()
    if (typeof value === "boolean") return value ? "true" : "false"
    if (value instanceof Error) {
        return value.message || value.name || "Error"
    }
    if (typeof value === "object") {
        try {
            return JSON.stringify(value)
        } catch (_err) {
            return inspect(value, { depth: 1 })
        }
    }
    return String(value)
}

const buildMetaSegments = (meta) => {
    if (!meta || typeof meta !== "object") return []

    const entries = []
    const { scope, icon: _icon, ...rest } = meta

    const scopeValue = sanitizeMetaValue(scope)
    if (scopeValue !== undefined) {
        entries.push(["scope", scopeValue])
    }

    for (const [key, rawValue] of Object.entries(rest)) {
        const value = sanitizeMetaValue(rawValue)
        if (value === undefined) continue
        entries.push([key, value])
    }

    return entries.map(([key, value]) => {
        const pair = `${key}=${value}`
        return COLOR_ENABLED ? dim(pair) : pair
    })
}

const formatConsoleMessage = ({ level, message, meta = {}, timestamp = new Date() }) => {
    const normalizedLevel = normalizeLevel(level)
    const timePart = dim(`[${formatTimestamp(timestamp)}]`)
    const levelLabel = normalizedLevel.toUpperCase().padEnd(LABEL_WIDTH)
    const levelPart = applyStyle(levelLabel, normalizedLevel)
    const scopeLabel = typeof meta === "object"
        ? (meta.scope || meta.process || "")
        : ""
    const scopePart = scopeLabel ? `${scopeLabel.padEnd(14)} | ` : ""
    const messageText = typeof message === "string" ? message : inspect(message)
    const metaSegments = buildMetaSegments(meta)

    let line = `${timePart} ${levelPart} ${scopePart}${messageText}`

    if (metaSegments.length > 0) {
        const separator = COLOR_ENABLED ? `${dim("│")}` : "|"
        line += ` ${separator} ${metaSegments.join(" ")}`
    }

    return line
}

const createLogPayload = (timestamp, level, message, meta) => ({
    timestamp: timestamp.toISOString(),
    level,
    message,
    ...meta
})

const logWithLevel = (level, message, meta = {}) => {
    const normalizedLevel = normalizeLevel(level)
    const effectiveMessage = typeof message === "string" ? message : inspect(message)
    const metaObject = meta && typeof meta === "object" ? { ...meta } : {}
    const timestamp = new Date()

    if (!isLevelEnabled(normalizedLevel)) {
        return createLogPayload(timestamp, normalizedLevel, effectiveMessage, metaObject)
    }

    const formatted = formatConsoleMessage({
        level: normalizedLevel,
        message: effectiveMessage,
        meta: metaObject,
        timestamp
    })

    const method = LEVEL_METHOD[normalizedLevel] || "log"
    console[method](formatted)

    return createLogPayload(timestamp, normalizedLevel, effectiveMessage, metaObject)
}

module.exports = {
    error: (message, meta) => logWithLevel("error", message, meta),
    warn: (message, meta) => logWithLevel("warn", message, meta),
    info: (message, meta) => logWithLevel("info", message, meta),
    debug: (message, meta) => logWithLevel("debug", message, meta),
    verbose: (message, meta) => logWithLevel("verbose", message, meta),
    log: logWithLevel,
    setLevel,
    getLevel,
    isLevelEnabled,
    formatConsoleMessage
}
