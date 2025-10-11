const defaultLogger = require("../logger")

const msSince = (startedAt) => Date.now() - startedAt

const createDiagnosticsService = ({
    client,
    cache,
    healthChecks = {},
    statusService,
    logger = defaultLogger
} = {}) => {
    if (!client) {
        throw new Error("Discord client is required to run diagnostics")
    }

    const runDiscordCheck = () => {
        const ready = typeof client.isReady === "function" ? client.isReady() : false
        const status = client.ws?.status ?? "unknown"
        const ping = Number.isFinite(client.ws?.ping) ? Math.round(client.ws.ping) : null
        const shardCount = client.ws?.shards?.size ?? 0
        return {
            ok: ready,
            ready,
            status,
            ping,
            shardCount,
            uptimeMs: client.uptime ?? null
        }
    }

    const runMysqlCheck = async() => {
        const startedAt = Date.now()
        try {
            if (typeof healthChecks.mysql === "function") {
                const result = await healthChecks.mysql()
                return {
                    ok: Boolean(result?.alive),
                    latencyMs: msSince(startedAt),
                    ...result
                }
            }

            if (typeof client.connection?.query === "function") {
                await client.connection.query("SELECT 1")
                return { ok: true, latencyMs: msSince(startedAt) }
            }

            return {
                ok: true,
                skipped: true,
                reason: "No MySQL health check available"
            }
        } catch (error) {
            return {
                ok: false,
                latencyMs: msSince(startedAt),
                error: error.message
            }
        }
    }

    const runCacheCheck = async() => {
        if (!cache) {
            return {
                ok: true,
                mode: "disabled",
                skipped: true
            }
        }

        const key = `diag:${Date.now()}`
        try {
            if (typeof cache.set !== "function" || typeof cache.get !== "function") {
                return {
                    ok: false,
                    mode: cache.type || "unknown",
                    error: "Cache client missing read/write methods"
                }
            }

            await cache.set(key, { timestamp: Date.now() }, 2)
            const value = await cache.get(key)
            return {
                ok: Boolean(value),
                mode: cache.type || (cache.isMemory ? "memory" : "unknown")
            }
        } catch (error) {
            return {
                ok: false,
                mode: cache.type || (cache.isMemory ? "memory" : "unknown"),
                error: error.message
            }
        } finally {
            if (typeof cache.del === "function") {
                Promise.resolve(cache.del(key)).catch(() => null)
            }
        }
    }

    const runStatusCheck = async() => {
        if (!statusService?.getBotStatus) {
            return {
                ok: true,
                skipped: true
            }
        }

        try {
            const snapshot = await statusService.getBotStatus({ reason: "diagnostics" })
            return {
                ok: true,
                enabled: snapshot?.enabled,
                guildCount: snapshot?.guildCount ?? null,
                health: snapshot?.health ?? null,
                updatedAt: snapshot?.updatedAt ?? null
            }
        } catch (error) {
            return {
                ok: false,
                error: error.message
            }
        }
    }

    const run = async(meta = {}) => {
        const [discord, mysql, cacheResult, status] = await Promise.all([
            runDiscordCheck(),
            runMysqlCheck(),
            runCacheCheck(),
            runStatusCheck()
        ])

        const services = {
            discord,
            mysql,
            cache: cacheResult,
            status
        }

        const issues = Object.entries(services)
            .filter(([, details]) => details && details.ok === false)
            .map(([key]) => key)

        const healthy = issues.length === 0

        logger.info("Diagnostics run completed", {
            scope: "diagnostics",
            healthy,
            issues,
            actor: meta.actor || "unknown",
            reason: meta.reason
        })

        return {
            performedAt: new Date().toISOString(),
            healthy,
            issues,
            services
        }
    }

    return {
        run
    }
}

module.exports = createDiagnosticsService
