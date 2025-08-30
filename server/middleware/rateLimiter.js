const { rateLimit, ipKeyGenerator } = require("express-rate-limit")
const { logger } = require("./structuredLogger")

const createRateLimitHandler = (type) => (req, res) => {
    const identifier = req.ip || req.connection.remoteAddress
    logger.warn("Rate limit exceeded", {
        type,
        identifier,
        path: req.path,
        method: req.method,
        requestId: req.requestId
    })

    // Use legacy format for frontend compatibility
    res.status(429).json({
        message: "429: Too Many Requests. Please try again later."
    })
}

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for health checks
        return req.path === "/api/health"
    },
    handler: createRateLimitHandler("global"),
    keyGenerator: (req) => {
        if (req.user?.id) {
            return req.user.id
        }
        return ipKeyGenerator(req)
    }
})

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 login attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
    handler: createRateLimitHandler("auth")
})

const adminReadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 reads per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler("admin-read")
})

const adminWriteLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 writes per minute
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler("admin-write")
})

const criticalActionLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Only 5 critical actions per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: true, // Don't count failed requests
    handler: createRateLimitHandler("critical-action")
})

const logWriteLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 log writes per minute (prevent log spam)
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler("log-write")
})

module.exports = {
    globalLimiter,
    authLimiter,
    adminReadLimiter,
    adminWriteLimiter,
    criticalActionLimiter,
    logWriteLimiter
}
