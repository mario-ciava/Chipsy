const winston = require("winston")
const path = require("path")
const fs = require("fs")

const LOG_LEVEL = process.env.LOG_LEVEL || "info"
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

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf((info) => {
        const { timestamp, level, message, metadata } = info
        const metaStr = Object.keys(metadata).length ? `\n${JSON.stringify(metadata, null, 2)}` : ""
        return `${timestamp} [${level}]: ${message}${metaStr}`
    })
)

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

if (process.env.NODE_ENV !== "production") {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }))
}

const requestLogger = (req, res, next) => {
    const requestId = req.headers["x-request-id"] || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    req.requestId = requestId
    req.startTime = Date.now()

    const originalSend = res.send
    res.send = function(data) {
        res.send = originalSend
        res.locals.responseBody = data
        return res.send(data)
    }

    res.on("finish", () => {
        const duration = Date.now() - req.startTime
        const logLevel = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"

        logger.log(logLevel, "HTTP Request", {
            requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get("user-agent"),
            userId: req.user?.id || null
        })
    })

    next()
}

module.exports = { logger, requestLogger }
