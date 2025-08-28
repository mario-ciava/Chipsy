const express = require("express")
const { sendSuccess, sendServiceUnavailable } = require("../utils/apiResponse")

const createHealthRouter = (dependencies) => {
    const { client, healthChecks = {} } = dependencies
    const router = express.Router()

    /**
     * Comprehensive health check endpoint
     * GET /health
     */
    router.get("/", async(req, res) => {
        const checks = {}
        let isHealthy = true

        // Check MySQL connection
        try {
            if (typeof healthChecks.mysql === "function") {
                checks.mysql = await healthChecks.mysql()
                if (!checks.mysql.alive) {
                    isHealthy = false
                }
            } else {
                checks.mysql = { alive: false, error: "Health check not available" }
                isHealthy = false
            }
        } catch (error) {
            checks.mysql = { alive: false, error: error.message }
            isHealthy = false
        }

        // Check Discord client
        try {
            checks.discord = {
                alive: client?.ws?.status === 0, // 0 = READY
                status: client?.ws?.status,
                ping: client?.ws?.ping || null,
                guilds: client?.guilds?.cache?.size || 0
            }
            if (!checks.discord.alive) {
                isHealthy = false
            }
        } catch (error) {
            checks.discord = { alive: false, error: error.message }
            isHealthy = false
        }

        // Check memory usage
        const memoryUsage = process.memoryUsage()
        const memoryUsageMB = {
            rss: Math.round(memoryUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            external: Math.round(memoryUsage.external / 1024 / 1024)
        }

        checks.memory = {
            alive: memoryUsageMB.heapUsed < 512, // Alert if heap usage > 512MB
            usage: memoryUsageMB,
            unit: "MB"
        }

        if (!checks.memory.alive) {
            isHealthy = false
        }

        // Check uptime
        checks.uptime = {
            alive: true,
            seconds: Math.floor(process.uptime()),
            formatted: formatUptime(process.uptime())
        }

        // Overall status
        const status = isHealthy ? "healthy" : "unhealthy"

        const responseData = {
            status,
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || "unknown",
            environment: process.env.NODE_ENV || "development",
            checks
        }

        if (isHealthy) {
            return sendSuccess(res, responseData)
        } else {
            return sendServiceUnavailable(res, "System")
        }
    })

    /**
     * Readiness check (for load balancers)
     * GET /ready
     */
    router.get("/ready", async(req, res) => {
        try {
            // Check if critical services are ready
            const mysqlCheck = await healthChecks.mysql?.() || { alive: false }
            const discordReady = client?.ws?.status === 0

            if (mysqlCheck.alive && discordReady) {
                return sendSuccess(res, {
                    ready: true,
                    timestamp: new Date().toISOString()
                })
            } else {
                return res.status(503).json({
                    ready: false,
                    timestamp: new Date().toISOString()
                })
            }
        } catch (error) {
            return res.status(503).json({
                ready: false,
                error: error.message,
                timestamp: new Date().toISOString()
            })
        }
    })

    /**
     * Liveness check (for Kubernetes)
     * GET /live
     */
    router.get("/live", (req, res) => {
        // Simple check: if the server can respond, it's alive
        return res.status(200).json({
            alive: true,
            timestamp: new Date().toISOString()
        })
    })

    return { router }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    const parts = []
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

    return parts.join(" ")
}

module.exports = createHealthRouter
