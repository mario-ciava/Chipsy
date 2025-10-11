const EventEmitter = require("events")
const createStatusBridge = require("../api/services/statusBridge")

describe("statusBridge", () => {
    const rpcClient = {
        getStatus: jest.fn().mockResolvedValue({ enabled: true }),
        refreshStatus: jest.fn().mockResolvedValue({ enabled: false }),
        getGuildSnapshot: jest.fn().mockResolvedValue({ id: "1" }),
        invalidateGuildSnapshot: jest.fn().mockResolvedValue(),
        getDiscordHealth: jest.fn().mockResolvedValue({ alive: true })
    }

    const webSocket = new EventEmitter()

    afterEach(() => {
        jest.clearAllMocks()
    })

    it("broadcasts status updates via websocket and broadcaster", async() => {
        const bridge = createStatusBridge({ rpcClient, webSocket, pollIntervalMs: 0 })
        const listener = jest.fn()
        bridge.registerBroadcaster(listener)
        await bridge.refreshBotStatus({ reason: "test" })
        expect(rpcClient.refreshStatus).toHaveBeenCalled()
        expect(listener).toHaveBeenCalledWith({
            status: { enabled: false },
            meta: { reason: "test" }
        })
    })

    it("proxies guild snapshot operations", async() => {
        const bridge = createStatusBridge({ rpcClient, webSocket, pollIntervalMs: 0 })
        await bridge.getGuildSnapshot("1", { forceRefresh: true })
        expect(rpcClient.invalidateGuildSnapshot).toHaveBeenCalledWith("1")
        expect(rpcClient.getGuildSnapshot).toHaveBeenCalledWith("1")
    })
})
