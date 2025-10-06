const express = require("express")

const createHealthRouter = (dependencies) => {
    const { client, healthChecks = {}, token: requiredToken = null } = dependencies
    const router = express.Router()

    const ensureAuthorized = (req, res, next) => {
        if (!requiredToken) {
            return next()
        }
        const token = req.get("x-health-token") || req.query.token
        if (!token || token !== requiredToken) {
            return res.status(401).json({
                status: "unauthorized",
                timestamp: new Date().toISOString()
            })
        }
        return next()
    }

    router.use(ensureAuthorized)

    router.get("/", async(req, res) => {
        const checks = {}
        let isHealthy = true

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

        try {
            checks.discord = {
                alive: client?.ws?.status === 0,
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

        const memoryUsage = process.memoryUsage()
        const memoryUsageMB = {
            rss: Math.round(memoryUsage.rss / 1024 / 1024),
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            external: Math.round(memoryUsage.external / 1024 / 1024)
        }

        checks.memory = {
            alive: memoryUsageMB.heapUsed < 512,
            usage: memoryUsageMB,
            unit: "MB"
        }

        if (!checks.memory.alive) {
            isHealthy = false
        }

        checks.uptime = {
            alive: true,
            seconds: Math.floor(process.uptime()),
            formatted: formatUptime(process.uptime())
        }

        const status = isHealthy ? "healthy" : "unhealthy"
        const statusCode = isHealthy ? 200 : 503

        return res.status(statusCode).json({
            status,
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || "unknown",
            environment: process.env.NODE_ENV || "development",
            checks
        })
    })

    router.get("/ready", async(req, res) => {
        try {
            const mysqlCheck = await healthChecks.mysql?.() || { alive: false }
            const discordReady = client?.ws?.status === 0

            const ready = mysqlCheck.alive && discordReady
            const statusCode = ready ? 200 : 503

            return res.status(statusCode).json({
                ready,
                timestamp: new Date().toISOString()
            })
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
