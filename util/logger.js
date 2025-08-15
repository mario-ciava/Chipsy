const levelToConsoleMethod = {
    info: "log",
    warn: "warn",
    error: "error",
    debug: "debug"
}

const formatLog = (level, message, meta = {}) => ({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
})

const logWithLevel = (level, message, meta) => {
    const payload = formatLog(level, message, meta)
    const serialized = JSON.stringify(payload)
    const method = levelToConsoleMethod[level] ?? "log"
    console[method](serialized)
    return payload
}

module.exports = {
    info: (message, meta) => logWithLevel("info", message, meta),
    warn: (message, meta) => logWithLevel("warn", message, meta),
    error: (message, meta) => logWithLevel("error", message, meta),
    debug: (message, meta) => logWithLevel("debug", message, meta)
}
