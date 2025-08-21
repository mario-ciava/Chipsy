const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m'
}

const levelColors = {
    info: colors.cyan,
    warn: colors.yellow,
    error: colors.red,
    debug: colors.magenta
}

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

const formatPretty = (level, message, meta = {}) => {
    const timestamp = new Date().toLocaleString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    })

    const levelColor = levelColors[level] || colors.white
    const levelText = level.toUpperCase().padEnd(5)

    let output = `${colors.gray}[${timestamp}]${colors.reset} ${levelColor}${levelText}${colors.reset} ${colors.bright}${message}${colors.reset}`

    // Add scope if present
    if (meta.scope) {
        output += ` ${colors.dim}[${meta.scope}]${colors.reset}`
    }

    // Add other meta data on new line if present
    const metaCopy = { ...meta }
    delete metaCopy.scope

    if (Object.keys(metaCopy).length > 0) {
        const metaStr = Object.entries(metaCopy)
            .map(([key, value]) => `${colors.dim}${key}=${colors.reset}${value}`)
            .join(' ')
        output += `\n       ${metaStr}`
    }

    return output
}

const logWithLevel = (level, message, meta) => {
    const payload = formatLog(level, message, meta)
    const pretty = formatPretty(level, message, meta)
    const method = levelToConsoleMethod[level] ?? "log"
    console[method](pretty)
    return payload
}

module.exports = {
    info: (message, meta) => logWithLevel("info", message, meta),
    warn: (message, meta) => logWithLevel("warn", message, meta),
    error: (message, meta) => logWithLevel("error", message, meta),
    debug: (message, meta) => logWithLevel("debug", message, meta)
}
