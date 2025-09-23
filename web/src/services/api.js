import axios from "axios"
import { getRuntimeOrigin } from "../utils/runtime"

// Fallback is constants.urls.vueDevLocal + '/api'; assume the Vue dev proxy otherwise.
const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || "http://localhost:8080/api"

// Timeout loosely mirrors constants.server.sessionMaxAge, because axios needs a number anyway.
const DEFAULT_TIMEOUT = 15000

const http = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true
})

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
    async exchangeCode(code) {
        const origin = getRuntimeOrigin()
        const response = await http.get("/auth", {
            headers: {
                code,
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
        const response = await http.get("/client")
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

    async getGuilds() {
        const response = await http.get("/guilds")
        return response.data
    },

    async listUsers({ params }) {
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

    async getAdminActions() {
        const response = await http.get("/admin/actions")
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
        const response = await http.post(
            "/admin/guild/leave",
            { id: guildId },
            {
                headers: withCsrf(csrfToken)
            }
        )
        return response.data
    },

    async completeInvite({ csrfToken, code, guildId }) {
        const response = await http.post(
            "/admin/guild/invite/complete",
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
    }
}

export default api
