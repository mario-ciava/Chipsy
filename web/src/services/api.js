import axios from "axios"
import { getRuntimeOrigin } from "../utils/runtime"

const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || "http://localhost:3000/api"
const DEFAULT_TIMEOUT = 15000

const http = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true
})

const withToken = (token, headers = {}) => {
    const next = { ...headers }
    if (token && !next.token) {
        next.token = token
    }
    return next
}

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

    async getCurrentUser(token) {
        const response = await http.get("/user", {
            headers: withToken(token)
        })
        return response.data
    },

    async getClientConfig(token) {
        const response = await http.get("/client", {
            headers: withToken(token)
        })
        return response.data
    },

    async getBotStatus(token) {
        const response = await http.get("/admin/status", {
            headers: withToken(token)
        })
        return response.data
    },

    async toggleBot({ token, csrfToken, enabled }) {
        const response = await http.patch(
            "/admin/bot",
            { enabled },
            {
                headers: withCsrf(csrfToken, withToken(token, { "Content-Type": "application/json" }))
            }
        )
        return response.data
    },

    async getGuilds(token) {
        const response = await http.get("/guilds", {
            headers: withToken(token)
        })
        return response.data
    },

    async listUsers({ token, params }) {
        const response = await http.get("/users", {
            params,
            headers: withToken(token)
        })
        return response.data
    },

    async getUserById({ token, id }) {
        const response = await http.get(`/users/${id}`, {
            headers: withToken(token)
        })
        return response.data
    },

    async getAdminActions(token) {
        const response = await http.get("/admin/actions", {
            headers: withToken(token)
        })
        return response.data
    },

    async leaveGuild({ token, csrfToken, guildId }) {
        const response = await http.post(
            "/admin/guild/leave",
            { id: guildId },
            {
                headers: withCsrf(csrfToken, withToken(token))
            }
        )
        return response.data
    },

    async logout({ token, user }) {
        const response = await http.post(
            "/logout",
            { user },
            {
                headers: withToken(token)
            }
        )
        return response.data
    }
}

export default api
