import axios from "axios"
import { getRuntimeOrigin } from "../utils/runtime"

const API_BASE_URL = process.env.VUE_APP_API_BASE_URL || "http://localhost:3000/api"
const DEFAULT_TIMEOUT = 15000

const http = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true
})

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

    async getAdminActions() {
        const response = await http.get("/admin/actions")
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
    }
}

export default api
