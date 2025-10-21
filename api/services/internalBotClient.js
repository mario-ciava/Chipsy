const fetch = require("node-fetch")
const { botRpc } = require("../../config")
const logger = require("../../shared/logger")

class InternalBotClient {
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl || botRpc.baseUrl || "").replace(/\/$/, "")
        this.token = options.token || botRpc.token || null
        this.timeoutMs = Number(options.timeoutMs || botRpc.timeoutMs || 8000)

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

    async request(path, { method = "GET", body, searchParams } = {}) {
        if (!this.baseUrl || !this.token) {
            throw new Error("Bot RPC client is not configured")
        }

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

            return payload
        } finally {
            clearTimeout(timeout)
        }
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
