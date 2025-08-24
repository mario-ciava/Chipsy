const fetch = require("node-fetch")

const createServer = require("../server/express")

class TestAgent {
    constructor(app) {
        this.app = app
        this.server = null
        this.baseUrl = null
        this.cookieJar = new Map()
    }

    async start() {
        if (this.server) return

        await new Promise((resolve) => {
            this.server = this.app.listen(0, () => {
                const address = this.server.address()
                this.baseUrl = `http://127.0.0.1:${address.port}`
                resolve()
            })
        })
    }

    applyCookies(headers) {
        if (this.cookieJar.size === 0) return

        const cookieHeader = Array.from(this.cookieJar.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join("; ")

        headers.set("cookie", cookieHeader)
    }

    storeCookies(setCookieHeaders = []) {
        for (const cookieHeader of setCookieHeaders) {
            const [pair] = cookieHeader.split(";")
            const [name, value] = pair.split("=")
            if (name) {
                this.cookieJar.set(name.trim(), (value || "").trim())
            }
        }
    }

    async request(path, options = {}) {
        await this.start()

        const headers = new fetch.Headers(options.headers || {})
        this.applyCookies(headers)

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers
        })

        const rawHeaders = response.headers.raw()
        if (rawHeaders["set-cookie"]) {
            this.storeCookies(rawHeaders["set-cookie"]) 
        }

        return response
    }

    async requestJson(path, options = {}) {
        const response = await this.request(path, options)
        const text = await response.text()
        const body = text ? JSON.parse(text) : undefined
        return { response, body }
    }

    async close() {
        if (!this.server) return

        await new Promise((resolve) => this.server.close(resolve))
        this.server = null
        this.baseUrl = null
        this.cookieJar.clear()
    }
}

describe("Express API integration", () => {
    let client
    let webSocket
    let discordApi
    let app
    let agent

    beforeEach(async() => {
        discordApi = {
            post: jest.fn(),
            get: jest.fn()
        }

        webSocket = {
            emit: jest.fn()
        }

        client = {
            config: {
                id: "client-id",
                secret: "client-secret",
                ownerid: "owner-id",
                prefix: "!",
                enabled: true
            },
            guilds: {
                cache: {
                    get: jest.fn((id) => (id === "1" ? { id: "1", name: "Guild One" } : undefined))
                }
            },
            dataHandler: {
                listUsers: jest.fn().mockResolvedValue({
                    items: [{
                        id: "user-1",
                        money: 5000,
                        gold: 2,
                        level: 3,
                        current_exp: 120,
                        required_exp: 200,
                        hands_played: 10,
                        hands_won: 4,
                        biggest_won: 2500,
                        biggest_bet: 500,
                        withholding_upgrade: 1,
                        reward_amount_upgrade: 1,
                        reward_time_upgrade: 0,
                        next_reward: null,
                        last_played: null
                    }],
                    pagination: {
                        page: 1,
                        pageSize: 25,
                        total: 1,
                        totalPages: 1
                    }
                }),
                getUserData: jest.fn().mockImplementation((id) => {
                    if (id === "user-1") {
                        return Promise.resolve({
                            id: "user-1",
                            money: 5000,
                            gold: 2,
                            level: 3,
                            current_exp: 120,
                            required_exp: 200,
                            hands_played: 10,
                            hands_won: 4,
                            biggest_won: 2500,
                            biggest_bet: 500,
                            withholding_upgrade: 1,
                            reward_amount_upgrade: 1,
                            reward_time_upgrade: 0,
                            next_reward: null,
                            last_played: null
                        })
                    }
                    return Promise.resolve(null)
                })
            },
            healthChecks: {
                mysql: jest.fn().mockResolvedValue({ alive: true })
            },
            logger: {
                info: jest.fn(),
                error: jest.fn()
            }
        }

        app = createServer(client, webSocket, {
            listen: false,
            rateLimiter: false,
            logger: false,
            discordApi
        })

        agent = new TestAgent(app)
        await agent.start()
    })

    afterEach(async() => {
        jest.clearAllMocks()
        await agent.close()
    })

    test("GET /api/auth exchanges the authorization code for tokens", async() => {
        discordApi.post.mockResolvedValue({
            data: {
                access_token: "access-token",
                refresh_token: "refresh-token",
                scope: "identify guilds",
                token_type: "Bearer"
            }
        })

        const { response, body } = await agent.requestJson("/api/auth", {
            method: "GET",
            headers: { code: "auth-code" }
        })

        expect(response.status).toBe(200)
        expect(body.access_token).toBe("access-token")
        expect(discordApi.post).toHaveBeenCalledWith(
            "/oauth2/token",
            expect.any(String),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: expect.stringContaining("Basic ") })
            })
        )
        expect(webSocket.emit).toHaveBeenCalledWith(
            "auth",
            expect.objectContaining({ token: "access-token" })
        )
    })

    test("GET /api/user validates the token and stores admin state", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        const { response, body } = await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(response.status).toBe(200)
        expect(discordApi.get).toHaveBeenCalledWith(
            "/users/@me",
            expect.objectContaining({
                headers: { Authorization: "Bearer access-token" }
            })
        )
        expect(body).toMatchObject({
            id: "owner-id",
            isAdmin: true
        })

        const clientConfig = await agent.requestJson("/api/client", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(clientConfig.response.status).toBe(200)
        expect(clientConfig.body).toMatchObject({ csrfToken: expect.any(String) })

        const turnOff = await agent.requestJson("/api/turnoff", {
            method: "POST",
            headers: {
                token: "access-token",
                "x-csrf-token": clientConfig.body.csrfToken
            }
        })

        expect(turnOff.response.status).toBe(200)
        expect(client.config.enabled).toBe(false)
    })

    test("GET /api/guilds returns guild metadata using cached session tokens", async() => {
        discordApi.get.mockImplementation((url) => {
            if (url === "/users/@me") {
                return Promise.resolve({
                    data: {
                        id: "user-id",
                        username: "User"
                    }
                })
            }

            if (url === "/users/@me/guilds") {
                return Promise.resolve({
                    data: [
                        { id: "1", name: "Guild One", permissions: "32" },
                        { id: "2", name: "Guild Two", permissions: "0" }
                    ]
                })
            }

            throw new Error(`Unexpected URL ${url}`)
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "session-token" }
        })

        const { response, body } = await agent.requestJson("/api/guilds")

        expect(response.status).toBe(200)
        expect(discordApi.get).toHaveBeenCalledWith(
            "/users/@me/guilds",
            expect.objectContaining({
                headers: { Authorization: "Bearer session-token" }
            })
        )
        expect(body.added).toHaveLength(1)
        expect(body.added[0]).toMatchObject({ id: "1" })
        expect(body.available).toEqual([])
    })

    test("GET /api/admin/status returns current bot state and health data", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const status = await agent.requestJson("/api/admin/status", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(status.response.status).toBe(200)
        expect(status.body).toMatchObject({
            enabled: true,
            health: { mysql: { alive: true } }
        })
        expect(client.healthChecks.mysql).toHaveBeenCalled()
    })

    test("PATCH /api/admin/bot toggles bot availability", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const clientConfig = await agent.requestJson("/api/client", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const toggleResponse = await agent.requestJson("/api/admin/bot", {
            method: "PATCH",
            headers: {
                token: "access-token",
                "content-type": "application/json",
                "x-csrf-token": clientConfig.body.csrfToken
            },
            body: JSON.stringify({ enabled: false })
        })

        expect(toggleResponse.response.status).toBe(200)
        expect(toggleResponse.body.enabled).toBe(false)
        expect(client.config.enabled).toBe(false)
        expect(webSocket.emit).toHaveBeenCalledWith("disable")
    })

    test("GET /api/users returns a paginated list of users", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const listResponse = await agent.requestJson("/api/users?page=2&pageSize=10&search=user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(listResponse.response.status).toBe(200)
        expect(listResponse.body.items).toHaveLength(1)
        expect(listResponse.body.items[0]).toMatchObject({
            id: "user-1",
            level: 3,
            winRate: 40
        })
        expect(client.dataHandler.listUsers).toHaveBeenCalledWith(expect.objectContaining({
            page: "2",
            pageSize: "10",
            search: "user"
        }))
    })

    test("GET /api/users/:id returns a single user profile", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const userResponse = await agent.requestJson("/api/users/user-1", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(userResponse.response.status).toBe(200)
        expect(userResponse.body).toMatchObject({
            id: "user-1",
            winRate: 40
        })

        const missingResponse = await agent.requestJson("/api/users/unknown", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(missingResponse.response.status).toBe(404)
    })

    test("GET /api/admin/actions exposes available remote commands", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const response = await agent.requestJson("/api/admin/actions", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(response.response.status).toBe(200)
        expect(response.body.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "bot-toggle",
                    supports: expect.arrayContaining(["enable", "disable"])
                })
            ])
        )
    })
})
