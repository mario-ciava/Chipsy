const fetch = require("node-fetch")

const createServer = require("../api/express")

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
    let statusService
    let adminService
    let discordDirectory

    beforeEach(async() => {
        discordApi = {
            post: jest.fn(),
            get: jest.fn()
        }

        webSocket = {
            emit: jest.fn()
        }

        statusService = {
            getBotStatus: jest.fn().mockResolvedValue({
                enabled: true,
                guildCount: 1,
                health: { mysql: { alive: true } },
                updatedAt: new Date().toISOString()
            }),
            refreshBotStatus: jest.fn().mockResolvedValue({
                enabled: false,
                guildCount: 1,
                health: { mysql: { alive: true } },
                updatedAt: new Date().toISOString()
            }),
            broadcastStatus: jest.fn(),
            getGuildSnapshot: jest.fn().mockImplementation((id) => {
                if (id === "1") {
                    return Promise.resolve({ id: "1", name: "Guild One" })
                }
                return Promise.resolve(null)
            }),
            invalidateGuildSnapshot: jest.fn(),
            registerBroadcaster: jest.fn()
        }

        const accessRecordFactory = (id) => ({
            userId: id,
            role: id === "owner-id" ? "MASTER" : "USER",
            isBlacklisted: false,
            isWhitelisted: id === "owner-id",
            updatedAt: null,
            persisted: id === "owner-id"
        })

        const defaultAccessRecord = (id) => Promise.resolve(accessRecordFactory(id))

        client = {
            config: {
                id: "client-id",
                secret: "client-secret",
                ownerid: "owner-id",
                enabled: true
            },
            isReady: jest.fn().mockReturnValue(true),
            ws: {
                status: "READY",
                ping: 42,
                shards: new Map()
            },
            uptime: 1000,
            guilds: {
                cache: {
                    get: jest.fn((id) => (id === "1" ? { id: "1", name: "Guild One" } : undefined))
                },
                fetch: jest.fn().mockResolvedValue({ id: "fetched" })
            },
            users: {
                cache: new Map(),
                fetch: jest.fn().mockResolvedValue(null)
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
                    if (id === "user-1" || id === "owner-id") {
                        return Promise.resolve({
                            id,
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
                            last_played: null,
                            join_date: null
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
            },
            accessControl: {
                getAccessRecord: jest.fn(defaultAccessRecord),
                getAccessRecords: jest.fn((ids = []) => {
                    const map = new Map()
                    ids.forEach((id) => map.set(id, accessRecordFactory(id)))
                    return Promise.resolve(map)
                }),
                getAccessPolicy: jest.fn().mockResolvedValue({
                    enforceWhitelist: false,
                    enforceBlacklist: true,
                    updatedAt: null
                }),
                setAccessPolicy: jest.fn().mockResolvedValue({
                    enforceWhitelist: true,
                    enforceBlacklist: true,
                    updatedAt: new Date().toISOString()
                }),
                setWhitelistEnforcement: jest.fn(), // legacy compatibility
                listAccessEntries: jest.fn().mockResolvedValue([]),
                evaluateBotAccess: jest.fn().mockResolvedValue({
                    allowed: true,
                    reason: null,
                    record: accessRecordFactory("user-1"),
                    policy: {
                        enforceWhitelist: false,
                        enforceBlacklist: true,
                        updatedAt: null
                    }
                }),
                setRole: jest.fn().mockResolvedValue({
                    userId: "user-1",
                    role: "MODERATOR",
                    isBlacklisted: false,
                    isWhitelisted: false
                }),
                updateLists: jest.fn().mockResolvedValue({
                    userId: "user-1",
                    role: "USER",
                    isBlacklisted: true,
                    isWhitelisted: false
                })
            }
        }

        client.statusService = statusService

        const mockActions = [
            { id: "bot-reload-config", type: "command" },
            { id: "bot-sync-commands", type: "concept" },
            { id: "bot-diagnostics", type: "command" }
        ]

        adminService = {
            getStatus: jest.fn().mockResolvedValue({ enabled: true, health: { mysql: { alive: true } } }),
            setBotEnabled: jest.fn().mockImplementation((enabled) => Promise.resolve({ enabled })),
            getClientConfig: jest.fn().mockReturnValue({ id: "client-id", panel: {} }),
            getGuild: jest.fn().mockResolvedValue({ id: "1" }),
            leaveGuild: jest.fn().mockResolvedValue({ ok: true }),
            completeInvite: jest.fn().mockResolvedValue({ status: "ok" }),
            listActions: jest.fn().mockReturnValue({ actions: mockActions }),
            executeAction: jest.fn().mockImplementation((actionId) => Promise.resolve({ actionId, status: "ok" })),
            listTables: jest.fn().mockReturnValue([]),
            controlTable: jest.fn().mockResolvedValue({ ok: true }),
            createLog: jest.fn().mockResolvedValue({ ok: true }),
            getLogs: jest.fn().mockResolvedValue({ items: [], cursor: null }),
            cleanupLogs: jest.fn().mockResolvedValue({ deleted: 0 })
        }

        discordDirectory = {
            resolveUsername: jest.fn().mockResolvedValue("Tester#0001"),
            lookupUserIdsByName: jest.fn().mockResolvedValue(["user-1"]),
            users: client.users,
            guilds: client.guilds
        }

        app = createServer(client, webSocket, {
            listen: false,
            rateLimiter: false,
            logger: false,
            discordApi,
            statusService,
            sessionOptions: {
                secret: "test-session-secret-32-characters-minimum"
            },
            adminService,
            dataHandler: client.dataHandler,
            accessControl: client.accessControl,
            discordDirectory
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
            isAdmin: true,
            role: "MASTER",
            permissions: expect.objectContaining({
                canAccessPanel: true,
                canViewLogs: true
            })
        })
        expect(body.profile).toMatchObject({
            id: "owner-id",
            level: 3,
            currentExp: 120
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

    test("POST /api/admin/guild/invite/complete finalizes bot invite", async() => {
        discordApi.get.mockResolvedValueOnce({
            data: {
                id: "owner-id",
                username: "Owner"
            }
        })

        const userResponse = await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(userResponse.response.status).toBe(200)

        const clientConfig = await agent.requestJson("/api/client", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const csrfToken = clientConfig.body.csrfToken
        expect(csrfToken).toBeTruthy()

        discordApi.post.mockResolvedValueOnce({
            data: {
                access_token: "bot-access",
                token_type: "Bearer",
                scope: "bot applications.commands"
            }
        })

        const inviteResponse = await agent.requestJson("/api/admin/guild/invite/complete", {
            method: "POST",
            headers: {
                token: "access-token",
                "x-csrf-token": csrfToken,
                "content-type": "application/json"
            },
            body: JSON.stringify({ code: "invite-code", guildId: "123456789012345678" })
        })

        expect(inviteResponse.response.status).toBe(200)
        expect(discordApi.post).toHaveBeenCalledWith(
            "/oauth2/token",
            expect.stringContaining("code=invite-code"),
            expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: expect.stringContaining("Basic "),
                    "Content-Type": "application/x-www-form-urlencoded"
                })
            })
        )
        const [, body] = discordApi.post.mock.calls.find(([url]) => url === "/oauth2/token")
        expect(body).toEqual(expect.stringContaining("client_id=client-id"))
        expect(body).toEqual(expect.stringMatching(/scope=bot(?:%20|\+)applications\.commands/))
        expect(client.guilds.fetch).toHaveBeenCalledWith("123456789012345678", { force: true })
        expect(inviteResponse.body).toHaveProperty("status")
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
        expect(statusService.getBotStatus).toHaveBeenCalled()
    })

    test("GET /api/admin/status returns 403 for non-admin users", async() => {
        discordApi.get.mockResolvedValue({
            data: {
                id: "user-2",
                username: "User"
            }
        })

        client.accessControl.getAccessRecord.mockImplementationOnce(() => Promise.resolve({
            userId: "user-2",
            role: "USER",
            isBlacklisted: false,
            isWhitelisted: false
        }))

        await agent.requestJson("/api/user", {
            method: "GET",
            headers: { token: "user-token" }
        })

        const status = await agent.requestJson("/api/admin/status", {
            method: "GET",
            headers: { token: "user-token" }
        })

        expect(status.response.status).toBe(403)
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
        expect(adminService.setBotEnabled).toHaveBeenCalledWith(false, expect.objectContaining({
            actor: "owner-id",
            reason: "admin:toggle"
        }))
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
            winRate: 40,
            panelRole: "USER",
            access: expect.objectContaining({
                role: "USER"
            })
        })
        expect(client.dataHandler.listUsers).toHaveBeenCalledWith(expect.objectContaining({
            page: 2,
            pageSize: 10,
            search: "user",
            sortBy: "last_played",
            sortDirection: "desc",
            activityDays: null
        }))
    })

    test("GET /api/users applies activity filters when requested", async() => {
        client.dataHandler.listUsers.mockClear()
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

        const listResponse = await agent.requestJson("/api/users?activity=30d", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(listResponse.response.status).toBe(200)
        expect(client.dataHandler.listUsers).toHaveBeenCalledWith(expect.objectContaining({
            activityDays: 30
        }))
    })

    test("GET /api/users supports username search through cached matches", async() => {
        client.dataHandler.listUsers.mockClear()
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

        client.users = {
            cache: new Map([
                ["user-1", { id: "user-1", username: "LuckyFox", discriminator: "0001" }],
                ["user-2", { id: "user-2", username: "CardPlayer" }]
            ])
        }

        const listResponse = await agent.requestJson("/api/users?search=lucky", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(listResponse.response.status).toBe(200)
        expect(client.dataHandler.listUsers).toHaveBeenCalledWith(expect.objectContaining({
            userIds: ["user-1"],
            search: "lucky"
        }))

        client.users = undefined
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
            winRate: 40,
            panelRole: "USER",
            access: expect.objectContaining({
                role: "USER"
            })
        })

        const missingResponse = await agent.requestJson("/api/users/unknown", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(missingResponse.response.status).toBe(404)
    })

    test("PATCH /api/users/:id/role updates the access role", async() => {
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

        client.accessControl.setRole.mockResolvedValueOnce({
            userId: "user-1",
            role: "MODERATOR",
            isBlacklisted: false,
            isWhitelisted: false
        })

        const response = await agent.requestJson("/api/users/user-1/role", {
            method: "PATCH",
            headers: {
                token: "access-token",
                "content-type": "application/json",
                "x-csrf-token": clientConfig.body.csrfToken
            },
            body: JSON.stringify({ role: "MODERATOR" })
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            role: "MODERATOR",
            access: expect.objectContaining({
                role: "MODERATOR"
            })
        })
        expect(client.accessControl.setRole).toHaveBeenCalledWith(expect.objectContaining({
            targetId: "user-1",
            nextRole: "MODERATOR"
        }))
    })

    test("PATCH /api/users/:id/lists toggles blacklist/whitelist flags", async() => {
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

        client.accessControl.updateLists.mockResolvedValueOnce({
            userId: "user-1",
            role: "USER",
            isBlacklisted: true,
            isWhitelisted: false
        })

        const response = await agent.requestJson("/api/users/user-1/lists", {
            method: "PATCH",
            headers: {
                token: "access-token",
                "content-type": "application/json",
                "x-csrf-token": clientConfig.body.csrfToken
            },
            body: JSON.stringify({ isBlacklisted: true })
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            role: "USER",
            isBlacklisted: true,
            isWhitelisted: false
        })
        expect(client.accessControl.updateLists).toHaveBeenCalledWith(expect.objectContaining({
            targetId: "user-1",
            isBlacklisted: true
        }))
    })

    test("GET /api/users/policy returns the current access policy", async() => {
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

        const response = await agent.requestJson("/api/users/policy", {
            method: "GET",
            headers: { token: "access-token" }
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            enforceWhitelist: false
        })
        expect(client.accessControl.getAccessPolicy).toHaveBeenCalledTimes(1)
    })

    test("PATCH /api/users/policy updates whitelist enforcement", async() => {
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

        client.accessControl.setAccessPolicy.mockResolvedValueOnce({
            enforceWhitelist: true,
            enforceBlacklist: true,
            updatedAt: new Date().toISOString()
        })

        const response = await agent.requestJson("/api/users/policy", {
            method: "PATCH",
            headers: {
                token: "access-token",
                "content-type": "application/json",
                "x-csrf-token": clientConfig.body.csrfToken
            },
            body: JSON.stringify({ enforceWhitelist: true })
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            enforceWhitelist: true
        })
        expect(client.accessControl.setAccessPolicy).toHaveBeenCalledWith({
            enforceBlacklist: undefined,
            enforceWhitelist: true
        })
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
        expect(response.body.actions || response.body).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: "bot-reload-config",
                    type: "command"
                }),
                expect.objectContaining({
                    id: "bot-sync-commands",
                    type: "concept"
                }),
                expect.objectContaining({
                    id: "bot-diagnostics",
                    type: "command"
                })
            ])
        )
    })

    test("POST /api/admin/actions/bot-reload-config reloads runtime config", async() => {
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

        const clientResponse = await agent.requestJson("/api/client", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const csrfToken = clientResponse.body.csrfToken

        const response = await agent.requestJson("/api/admin/actions/bot-reload-config", {
            method: "POST",
            headers: {
                token: "access-token",
                "x-csrf-token": csrfToken
            }
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            actionId: "bot-reload-config",
            status: "ok"
        })
    })

    test("POST /api/admin/actions/bot-diagnostics returns service status", async() => {
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

        const clientResponse = await agent.requestJson("/api/client", {
            method: "GET",
            headers: { token: "access-token" }
        })

        const response = await agent.requestJson("/api/admin/actions/bot-diagnostics", {
            method: "POST",
            headers: {
                token: "access-token",
                "x-csrf-token": clientResponse.body.csrfToken
            }
        })

        expect(response.response.status).toBe(200)
        expect(response.body).toMatchObject({
            actionId: "bot-diagnostics",
            status: "ok"
        })
        expect(response.body.report).toBeDefined()
        expect(response.body.report.services.mysql.ok).toBe(true)
    })
})
