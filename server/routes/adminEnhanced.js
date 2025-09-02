/**
 * Enhanced Admin Router Factory
 * Returns admin router with middleware properly applied to endpoints
 */

const createAdminRouter = require("./admin")
const { adminSchemas, validate } = require("../validation/schemas")
const {
    adminReadLimiter,
    adminWriteLimiter,
    criticalActionLimiter,
    logWriteLimiter
} = require("../middleware/rateLimiter")

/**
 * Middleware collections for different endpoint types
 */
const middleware = {
    // Critical actions: strict rate limiting + validation
    critical: {
        toggleBot: [criticalActionLimiter, validate(adminSchemas.toggleBot, "body")],
        kill: [criticalActionLimiter],
        turnOff: [criticalActionLimiter],
        turnOn: [criticalActionLimiter]
    },

    // Read operations: moderate rate limiting
    read: {
        status: [adminReadLimiter],
        actions: [adminReadLimiter],
        getLogs: [adminReadLimiter, validate(adminSchemas.getLogs, "query")]
    },

    // Write operations: rate limiting + validation
    write: {
        leaveGuild: [adminWriteLimiter, validate(adminSchemas.leaveGuild, "body")],
        completeInvite: [adminWriteLimiter, validate(adminSchemas.completeInvite, "body")],
        createLog: [logWriteLimiter, validate(adminSchemas.createLog, "body")]
    }
}

/**
 * Create enhanced admin router with middleware applied
 */
const createEnhancedAdminRouter = (dependencies) => {
    const { router: baseRouter, handlers } = createAdminRouter(dependencies)

    // Apply middleware to specific endpoints in /admin router
    // We need to re-register endpoints with middleware

    // Get the existing route layer
    const express = require("express")
    const enhancedRouter = express.Router()

    // Copy all routes from baseRouter to enhancedRouter
    baseRouter.stack.forEach((layer) => {
        if (layer.route) {
            const path = layer.route.path
            const method = Object.keys(layer.route.methods)[0]

            // Determine which middleware to apply based on path
            // Note: CSRF token check is already in the original handlers
            let middlewareToApply = []

            if (path === "/status" && method === "get") {
                middlewareToApply = middleware.read.status
            } else if (path === "/bot" && method === "patch") {
                middlewareToApply = middleware.critical.toggleBot
            } else if (path === "/kill" && method === "post") {
                middlewareToApply = middleware.critical.kill
            } else if (path === "/logs" && method === "get") {
                middlewareToApply = middleware.read.getLogs
            } else if (path === "/logs" && method === "post") {
                middlewareToApply = middleware.write.createLog
            } else if (path === "/logs/cleanup" && method === "delete") {
                middlewareToApply = [adminWriteLimiter]
            } else if (path === "/guild/leave" && method === "post") {
                middlewareToApply = middleware.write.leaveGuild
            } else if (path === "/guild/invite/complete" && method === "post") {
                middlewareToApply = middleware.write.completeInvite
            } else if (path === "/actions" && method === "get") {
                middlewareToApply = middleware.read.actions
            } else if (path === "/guild" && method === "get") {
                middlewareToApply = middleware.read.status
            } else if (path === "/client" && method === "get") {
                middlewareToApply = middleware.read.status
            } else if (path === "/turnoff" && method === "post") {
                middlewareToApply = middleware.critical.turnOff
            } else if (path === "/turnon" && method === "post") {
                middlewareToApply = middleware.critical.turnOn
            }

            // Re-register with middleware
            const handlers = layer.route.stack.map((s) => s.handle)
            enhancedRouter[method](path, ...middlewareToApply, ...handlers)
        }
    })

    // Note: Middleware are still exported for manual application if needed
    return {
        router: enhancedRouter,
        handlers,
        middleware
    }
}

module.exports = createEnhancedAdminRouter
