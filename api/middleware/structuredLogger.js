const winston = require("winston")
const path = require("path")
const fs = require("fs")
const sharedLogger = require("../../shared/logger")

const LOG_LEVEL = process.env.LOG_LEVEL || sharedLogger.getLevel()
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "../../logs")

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
}

const customFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ["message", "level", "timestamp", "label"] }),
    winston.format.json()
)

const consoleFormat = winston.format.printf((info) => {
    const { level, message, metadata } = info
    return sharedLogger.formatConsoleMessage({
        level,
        message,
        meta: metadata || {}
    })
})

const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: customFormat,
    defaultMeta: { service: "chipsy-api" },
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, "error.log"),
            level: "error",
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(LOG_DIR, "combined.log"),
            maxsize: 5242880,
            maxFiles: 5
        })
    ],
    exceptionHandlers: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, "exceptions.log")
        })
    ],
    rejectionHandlers: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, "rejections.log")
        })
    ]
})

logger.add(new winston.transports.Console({
    format: consoleFormat,
    level: LOG_LEVEL
}))

const SKIP_PATHS = new Set(["/api/health", "/health", "/favicon.ico"])
const SKIP_PREFIXES = ["/__webpack", "/sockjs", "/static/", "/assets/"]
const isProduction = process.env.NODE_ENV === "production"

const shouldSkipRequest = (req) => {
    const pathValue = (req.originalUrl || req.url || req.path || "").toLowerCase()
    if (!pathValue) return false
    if (SKIP_PATHS.has(pathValue)) return true
    if (req.method === "OPTIONS") return true
    return SKIP_PREFIXES.some((prefix) => pathValue.startsWith(prefix))
}

const requestLogger = (req, res, next) => {
    const requestId = req.headers["x-request-id"] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    req.requestId = requestId
    req.startTime = Date.now()

    res.on("finish", () => {
        const duration = Date.now() - req.startTime
        const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"
        const pathLabel = req.originalUrl || req.url || req.path

        if (shouldSkipRequest(req)) {
            return
        }

        if (!isProduction && res.statusCode < 400 && !sharedLogger.isLevelEnabled("verbose")) {
            return
        }

        logger.log(logLevel, `${req.method} ${pathLabel}`, {
            scope: "http",
            requestId,
            method: req.method,
            path: pathLabel,
            statusCode: res.statusCode,
            durationMs: duration,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get("user-agent") || undefined,
            userId: req.user?.id || undefined
        })
    })

    next()
}

module.exports = { logger, requestLogger }
