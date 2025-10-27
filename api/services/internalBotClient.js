const fetch = require("node-fetch")
const { botRpc } = require("../../config")
const logger = require("../../shared/logger")

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BACKOFF_MS = 250
const DEFAULT_BREAKER_THRESHOLD = 3
const DEFAULT_BREAKER_RESET_MS = 15000
const SLOW_REQUEST_THRESHOLD_MS = 500

class InternalBotClient {
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl || botRpc.baseUrl || "").replace(/\/$/, "")
        this.token = options.token || botRpc.token || null
        this.timeoutMs = Number(options.timeoutMs || botRpc.timeoutMs || 8000)
        this.maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : DEFAULT_MAX_RETRIES
        this.backoffMs = Number.isFinite(options.backoffMs) ? options.backoffMs : DEFAULT_BACKOFF_MS
        this.breakerThreshold = Number.isFinite(options.breakerThreshold)
            ? options.breakerThreshold
            : DEFAULT_BREAKER_THRESHOLD
        this.breakerResetMs = Number.isFinite(options.breakerResetMs)
            ? options.breakerResetMs
            : DEFAULT_BREAKER_RESET_MS
        this.slowThresholdMs = Number.isFinite(options.slowThresholdMs)
            ? options.slowThresholdMs
            : SLOW_REQUEST_THRESHOLD_MS
        this.timeoutStreak = 0
        this.breakerOpenedAt = 0
        this.metrics = new Map()

        if (!this.baseUrl) {
            logger.warn("BOT_RPC_BASE_URL is not configured. Remote bot operations will fail.", {
                scope: "botRpc"
            })
        }
        if (!this.token) {
            logger.warn("BOT_RPC_TOKEN is not configured. Remote bot operations will fail.", {
                scope: "botRpc"
            })
        }
    }

    isBreakerOpen() {
        if (!this.breakerOpenedAt) return false
        if (Date.now() - this.breakerOpenedAt >= this.breakerResetMs) {
            this.breakerOpenedAt = 0
            return false
        }
        return true
    }

    openBreaker() {
        if (!this.breakerOpenedAt) {
            logger.warn("Bot RPC circuit breaker opened due to repeated timeouts", { scope: "botRpc" })
        }
        this.timeoutStreak = 0
        this.breakerOpenedAt = Date.now()
    }

    recordMetric(routeKey, type) {
        const current = this.metrics.get(routeKey) || { success: 0, timeout: 0, error: 0 }
        current[type] = (current[type] || 0) + 1
        this.metrics.set(routeKey, current)
    }

    async delay(ms) {
        if (!Number.isFinite(ms) || ms <= 0) return
        await new Promise((resolve) => setTimeout(resolve, ms))
    }

    shouldRetry(error) {
        if (!error) return false
        if (error.name === "AbortError") {
            return true
        }
        if (typeof error.status === "number") {
            return error.status >= 500
        }
        return false
    }

    async request(path, { method = "GET", body, searchParams } = {}) {
        if (!this.baseUrl || !this.token) {
            throw new Error("Bot RPC client is not configured")
        }

        if (this.isBreakerOpen()) {
            const error = new Error("Bot RPC circuit breaker open")
            error.code = "BOT_RPC_BREAKER_OPEN"
            throw error
        }

        const normalizedMethod = method.toUpperCase()
        const routeKey = `${normalizedMethod} ${path}`
        const maxAttempts = this.maxRetries + 1
        let attempt = 0
        let lastError = null

        while (attempt < maxAttempts) {
            const startedAt = Date.now()
            try {
                const { payload, status } = await this.performFetch({
                    path,
                    method: normalizedMethod,
                    body,
                    searchParams
                })
                const durationMs = Date.now() - startedAt
                this.recordMetric(routeKey, "success")
                this.timeoutStreak = 0
                this.logSuccess({ method: normalizedMethod, path, status, durationMs, attempt })
                return payload
            } catch (error) {
                lastError = error
                const durationMs = Date.now() - startedAt
                const isTimeout = error.name === "AbortError"
                const status = typeof error.status === "number" ? error.status : null
                this.recordMetric(routeKey, isTimeout ? "timeout" : "error")
                this.logFailure({
                    method: normalizedMethod,
                    path,
                    status,
                    durationMs,
                    attempt,
                    error,
                    isTimeout
                })

                if (isTimeout) {
                    this.timeoutStreak += 1
                    if (this.timeoutStreak >= this.breakerThreshold) {
                        this.openBreaker()
                    }
                } else {
                    this.timeoutStreak = 0
                }

                if (attempt >= maxAttempts - 1 || !this.shouldRetry(error)) {
                    throw error
                }

                await this.delay(this.backoffMs * (2 ** attempt))
                attempt += 1
            }
        }

        throw lastError
    }

    async performFetch({ path, method, body, searchParams }) {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

        try {
            const url = new URL(`${this.baseUrl}${path}`)
            if (searchParams && typeof searchParams === "object") {
                Object.entries(searchParams).forEach(([key, value]) => {
                    if (value === undefined || value === null) return
                    url.searchParams.set(key, value)
                })
            }

            const headers = {
                "x-internal-token": this.token,
                "content-type": "application/json"
            }

            const response = await fetch(url, {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined,
                signal: controller.signal
            })

            const text = await response.text()
            let payload
            try {
                payload = text ? JSON.parse(text) : null
            } catch (error) {
                payload = text || null
            }

            if (!response.ok) {
                const error = new Error(payload?.message || response.statusText || "Bot RPC error")
                error.status = response.status
                error.payload = payload
                throw error
            }

            return { payload, status: response.status }
        } finally {
            clearTimeout(timeout)
        }
    }

    logSuccess({ method, path, status, durationMs, attempt }) {
        const level = durationMs > this.slowThresholdMs ? "warn" : "info"
        logger[level]("Bot RPC request succeeded", {
            scope: "botRpc",
            method,
            path,
            status,
            durationMs,
            attempt
        })
    }

    logFailure({ method, path, status, durationMs, attempt, error, isTimeout }) {
        logger.warn("Bot RPC request failed", {
            scope: "botRpc",
            method,
            path,
            status: status || null,
            durationMs,
            attempt,
            timeout: isTimeout,
            error: error?.message
        })
    }

    getStatus() {
        return this.request("/status")
    }

    refreshStatus() {
        return this.request("/status/refresh", { method: "POST" })
    }

    getGuildSnapshot(guildId) {
        return this.request(`/status/guilds/${guildId}`)
    }

    invalidateGuildSnapshot(guildId) {
        return this.request(`/status/guilds/${guildId}`, { method: "DELETE" })
    }

    setBotEnabled(enabled, meta = {}) {
        return this.request("/bot", { method: "PATCH", body: { enabled, actor: meta.actor } })
    }

    getClientConfig() {
        return this.request("/admin/client")
    }

    getGuild(guildId) {
        return this.request(`/admin/guilds/${guildId}`)
    }

    leaveGuild(guildId, meta = {}) {
        return this.request(`/admin/guilds/${guildId}/leave`, { method: "POST", body: { actor: meta.actor } })
    }

    completeInvite(payload) {
        return this.request("/admin/invite/complete", { method: "POST", body: payload })
    }

    listActions() {
        return this.request("/admin/actions")
    }

    executeAction(actionId, metadata = {}) {
        return this.request(`/admin/actions/${actionId}`, { method: "POST", body: { metadata } })
    }

    listTables() {
        return this.request("/admin/tables")
    }

    controlTable(tableId, payload) {
        return this.request(`/admin/tables/${tableId}/actions`, { method: "POST", body: payload })
    }

    createLog(payload) {
        return this.request("/admin/logs", { method: "POST", body: payload })
    }

    getLogs(params) {
        return this.request("/admin/logs", { searchParams: params })
    }

    cleanupLogs() {
        return this.request("/admin/logs", { method: "DELETE" })
    }

    lookupUserIds(query) {
        return this.request("/discord/users", { searchParams: { q: query } })
    }

    fetchUser(userId) {
        return this.request(`/discord/users/${userId}`)
    }

    fetchGuild(guildId) {
        return this.request(`/discord/guilds/${guildId}`)
    }

    listGuilds() {
        return this.request("/discord/guilds")
    }

    getDiscordHealth() {
        return this.request("/health/discord")
    }
}

module.exports = InternalBotClient
