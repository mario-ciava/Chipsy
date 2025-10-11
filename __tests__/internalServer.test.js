const request = require("supertest")
jest.mock("../shared/services/adminService", () => jest.fn(() => ({
    getStatus: jest.fn().mockResolvedValue({ enabled: true }),
    setBotEnabled: jest.fn().mockResolvedValue({ enabled: false }),
    getClientConfig: jest.fn().mockReturnValue({ id: "client" }),
    getGuild: jest.fn(),
    leaveGuild: jest.fn(),
    completeInvite: jest.fn(),
    executeAction: jest.fn(),
    listActions: jest.fn(() => []),
    listTables: jest.fn(() => []),
    controlTable: jest.fn(),
    createLog: jest.fn(),
    getLogs: jest.fn(),
    cleanupLogs: jest.fn()
})))
const startInternalServer = require("../bot/internal/server")

describe("internal control server", () => {
    const client = {
        config: {
            id: "client",
            secret: "secret",
            redirectUri: "http://localhost",
            enabled: true
        },
        guilds: { cache: new Map(), fetch: jest.fn().mockResolvedValue(null) },
        ws: { status: 0, ping: 42, shards: { size: 1 } },
        isReady: jest.fn().mockReturnValue(true)
    }
    const webSocket = {
        emit: jest.fn()
    }
    const statusService = {
        getBotStatus: jest.fn().mockResolvedValue({ enabled: true }),
        refreshBotStatus: jest.fn().mockResolvedValue({ enabled: false }),
        getGuildSnapshot: jest.fn().mockResolvedValue({ id: "1" }),
        invalidateGuildSnapshot: jest.fn().mockResolvedValue(),
        registerBroadcaster: jest.fn()
    }

    let server

    beforeAll(() => {
        process.env.INTERNAL_API_TOKEN = "test-token"
        server = startInternalServer({
            client,
            webSocket,
            statusService,
            config: { token: "test-token", port: 0, host: "127.0.0.1", path: "/internal", enabled: true }
        })
    })

    afterAll(async() => {
        await server.close()
    })

    it("rejects missing tokens", async() => {
        await request(server.app).get("/internal/status").expect(401)
    })

    it("returns bot status when token is valid", async() => {
        await request(server.app)
            .get("/internal/status")
            .set("x-internal-token", "test-token")
            .expect(200)
    })
})
