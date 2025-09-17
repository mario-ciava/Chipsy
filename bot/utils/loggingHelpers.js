const logger = require("./logger")

const serializeError = (error) => {
    if (!error) return "Unknown error"
    if (error instanceof Error) {
        return error.message || error.name || "Error"
    }
    if (typeof error === "object") {
        try {
            return JSON.stringify(error)
        } catch {
            return String(error)
        }
    }
    return String(error)
}

const logAndSuppress = (message, meta = {}, options = {}) => {
    const level = typeof options.level === "string" ? options.level : "warn"
    const returnValue = options.hasOwnProperty("returnValue") ? options.returnValue : null
    const includeStack = options.includeStack !== false

    const logFn = typeof logger[level] === "function" ? logger[level] : logger.warn
    return (error) => {
        const payload = {
            ...meta,
            error: serializeError(error)
        }

        if (includeStack && error?.stack) {
            payload.stack = error.stack
        }

        logFn(message, payload)
        return returnValue
    }
}

module.exports = {
    logAndSuppress
}
