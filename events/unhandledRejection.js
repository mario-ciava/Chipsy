const { error: logError } = require("../util/logger")

module.exports = (reason, promise) => {
    logError("Unhandled promise rejection", {
        scope: "process",
        event: "unhandledRejection",
        message: reason?.message ?? String(reason),
        stack: reason?.stack,
        promise: promise?.constructor?.name ?? undefined
    })
}
