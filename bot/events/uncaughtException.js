const { error: logError } = require("../utils/logger")

module.exports = (error, origin) => {
    logError("Uncaught exception", {
        scope: "process",
        event: "uncaughtException",
        message: error?.message ?? String(error),
        stack: error?.stack,
        origin
    })
}
