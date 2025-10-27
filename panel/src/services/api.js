import axios from "axios"
import { getRuntimeOrigin } from "../utils/runtime"

// Fallback è runtime origin + '/api/v1' per evitare hardcode su localhost
const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || `${getRuntimeOrigin()}/api/v1`

// Timeout loosely mirrors constants.server.sessionMaxAge, because axios needs a number anyway.
const DEFAULT_TIMEOUT = 15000

const http = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true
})

export const applyRuntimeConfig = (panelConfig = {}) => {
    const timeout = Number(panelConfig?.http?.timeoutMs)
    http.defaults.timeout = Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT
}

http.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
            const currentPath = window.location.pathname
            if (currentPath !== "/login" && currentPath !== "/") {
                window.dispatchEvent(new CustomEvent("session-expired"))
            }
        }
        return Promise.reject(error)
    }
)

const withCsrf = (csrfToken, headers = {}) => {
    const next = { ...headers }
    if (csrfToken && !next["x-csrf-token"]) {
        next["x-csrf-token"] = csrfToken
    }
    return next
}

const api = {
    async getOAuthState(redirectUri) {
        const params = {}
        if (redirectUri) {
            params.redirectUri = redirectUri
        }
        const response = await http.get("/auth/state", { params })
        return response.data
    },

    async exchangeCode(code, state) {
        const origin = getRuntimeOrigin()
        const params = {}
        if (code) {
            params.code = code
        }
        if (state) {
            params.state = state
        }
        const response = await http.get("/auth", {
            params,
            headers: {
                "x-redirect-origin": origin
            }
        })
        return response.data
    },

    async getCurrentUser() {
        const response = await http.get("/user")
        return response.data
    },

    async getClientConfig() {
        const response = await http.get("/admin/client")
        return response.data
    },

    async getBotStatus() {
        const response = await http.get("/admin/status")
        return response.data
    },

    async toggleBot({ csrfToken, enabled }) {
        const response = await http.patch(
            "/admin/bot",
            { enabled },
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },

    async getGuilds({ forceRefresh = false } = {}) {
        const params = {}
        if (forceRefresh) {
            params.refresh = "true"
        }
        const response = await http.get("/guilds", { params })
        return response.data
    },

    async listUsers({
        page,
        pageSize,
        search,
        role,
        list,
        minLevel,
        maxLevel,
        minBalance,
        maxBalance,
        activity,
        sortBy,
        sortDirection
    } = {}) {
        const params = {}
        const assignIfPresent = (key, value) => {
            if (value === undefined || value === null || value === "") return
            params[key] = value
        }

        assignIfPresent("page", page)
        assignIfPresent("pageSize", pageSize)

        if (typeof search === "string") {
            const trimmed = search.trim()
            if (trimmed.length > 0) {
                params.search = trimmed
            }
        }

        assignIfPresent("role", role)
        assignIfPresent("list", list)
        assignIfPresent("minLevel", minLevel)
        assignIfPresent("maxLevel", maxLevel)
        assignIfPresent("minBalance", minBalance)
        assignIfPresent("maxBalance", maxBalance)
        assignIfPresent("activity", activity)
        assignIfPresent("sortBy", sortBy)
        assignIfPresent("sortDirection", sortDirection)

        const response = await http.get("/users", { params })
        return response.data
    },

    async getUserById({ id }) {
        const response = await http.get(`/users/${id}`)
        return response.data
    },
    async updateUserRole({ csrfToken, userId, role }) {
        if (!userId || !role) {
            throw new Error("Missing role update parameters")
        }
        const response = await http.patch(
            `/users/${userId}/role`,
            { role },
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },
    async updateUserLists({ csrfToken, userId, isBlacklisted, isWhitelisted }) {
        if (!userId) {
            throw new Error("Missing user id for list update")
        }
        const payload = {}
        if (typeof isBlacklisted === "boolean") {
            payload.isBlacklisted = isBlacklisted
        }
        if (typeof isWhitelisted === "boolean") {
            payload.isWhitelisted = isWhitelisted
        }
        const response = await http.patch(
            `/users/${userId}/lists`,
            payload,
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },
    async updateUserStats({ csrfToken, userId, level, currentExp, money, gold }) {
        if (!userId) {
            throw new Error("Missing user id for progression update")
        }
        const response = await http.patch(
            `/users/${userId}/stats`,
            {
                level,
                currentExp,
                money,
                gold
            },
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },

    async getAccessPolicy() {
        const response = await http.get("/users/policy")
        return response.data
    },

    async updateAccessPolicy({ csrfToken, enforceWhitelist, enforceBlacklist }) {
        if (typeof enforceWhitelist !== "boolean" && typeof enforceBlacklist !== "boolean") {
            throw new Error("Missing policy updates")
        }
        const payload = {}
        if (typeof enforceWhitelist === "boolean") {
            payload.enforceWhitelist = enforceWhitelist
        }
        if (typeof enforceBlacklist === "boolean") {
            payload.enforceBlacklist = enforceBlacklist
        }
        const response = await http.patch(
            "/users/policy",
            payload,
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },

    async getAccessList({ type }) {
        if (!type) {
            throw new Error("Missing list type")
        }
        const response = await http.get("/users/lists", {
            params: { type }
        })
        return response.data
    },

    async getAdminActions() {
        const response = await http.get("/admin/actions")
        return response.data
    },

    async getActiveTables() {
        const response = await http.get("/admin/tables")
        return response.data
    },

    async controlTable({ csrfToken, tableId, action }) {
        if (!tableId || !action) {
            throw new Error("Missing table action parameters")
        }
        const response = await http.post(
            `/admin/tables/${encodeURIComponent(tableId)}/actions`,
            { action },
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },

    async runAdminAction({ csrfToken, actionId }) {
        if (!actionId) {
            throw new Error("Missing action id")
        }
        const response = await http.post(
            `/admin/actions/${actionId}`,
            {},
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async leaveGuild({ csrfToken, guildId }) {
        if (!guildId) {
            throw new Error("Missing guild id")
        }
        const response = await http.post(
            "/admin/guild/leave",
            { id: guildId },
            {
                headers: withCsrf(csrfToken, { "Content-Type": "application/json" })
            }
        )
        return response.data
    },

    async completeInvite({ csrfToken, code, guildId }) {
        const response = await http.post(
            "/admin/invite/complete",
            { code, guildId },
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async logout({ csrfToken, user }) {
        const response = await http.post(
            "/logout",
            { user },
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async killBot({ csrfToken }) {
        const response = await http.post(
            "/admin/kill",
            {},
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async saveLog({ csrfToken, level, message, logType = "general", userId = null }) {
        const response = await http.post(
            "/admin/logs",
            { level, message, logType, userId },
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async getLogs({ logType = "general", limit = 100 }) {
        const response = await http.get("/admin/logs", {
            params: { type: logType, limit }
        })
        return response.data
    },

    async cleanupOldLogs({ csrfToken }) {
        const response = await http.delete("/admin/logs/cleanup", {
            headers: withCsrf(csrfToken)
        })
        return response.data
    },

    async getLeaderboardTop({ metric, limit } = {}) {
        const params = {}
        if (metric) {
            params.metric = metric
        }
        if (limit) {
            params.limit = limit
        }
        const response = await http.get("/leaderboard/top", { params })
        return response.data
    },

    async listLeaderboard({ metric, page, pageSize, search } = {}) {
        const params = {}
        if (metric) {
            params.metric = metric
        }
        if (page) {
            params.page = page
        }
        if (pageSize) {
            params.pageSize = pageSize
        }
        if (typeof search === "string" && search.trim()) {
            params.search = search.trim()
        }
        const response = await http.get("/leaderboard", { params })
        return response.data
    },

    async getLeaderboardMe({ metric } = {}) {
        const params = {}
        if (metric) {
            params.metric = metric
        }
        const response = await http.get("/leaderboard/me", { params })
        return response.data
    }
}

export default api
