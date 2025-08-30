const WebSocket = require("ws")
const { logger } = require("../middleware/structuredLogger")

const SAFE_EVENTS = new Set(["ping", "status:refresh"]) 

const createStatusWebSocketServer = ({
    server,
    path = "/ws/status",
    webSocketEmitter,
    statusService,
    log = logger
}) => {
    if (!server) {
        throw new Error("HTTP server instance is required to initialize the WebSocket bridge")
    }

    const wss = new WebSocket.Server({ server, path })
    const clients = new Set()
    const emitterListeners = []

    const safeSend = (socket, payload) => {
        if (socket.readyState !== WebSocket.OPEN) return
        try {
            socket.send(JSON.stringify(payload))
        } catch (err) {
            log.warn("Failed to send WebSocket payload", {
                scope: "ws",
                message: err.message
            })
        }
    }

    const broadcast = (payload) => {
        for (const socket of clients) {
            safeSend(socket, payload)
        }
    }

    const pushStatus = async(meta = {}) => {
        try {
            const status = await statusService.getBotStatus({ reason: meta.reason })
            if (status) {
                broadcast({ event: "status:update", data: status, meta })
            }
        } catch (err) {
            log.warn("Failed to compute status for WebSocket broadcast", {
                scope: "ws",
                message: err.message
            })
        }
    }

    const handleEmitterPayload = ({ status, meta }) => {
        if (status) {
            broadcast({ event: "status:update", data: status, meta })
        }
    }

    const attachEmitter = () => {
        if (!webSocketEmitter) return

        const statusListener = (payload) => handleEmitterPayload(payload || {})
        const enableListener = () => pushStatus({ reason: "enable" })
        const disableListener = () => pushStatus({ reason: "disable" })
        const authListener = (data) => broadcast({ event: "auth", data })
        const logoutListener = (data) => broadcast({ event: "logout", data })

        webSocketEmitter.on("status:update", statusListener)
        webSocketEmitter.on("enable", enableListener)
        webSocketEmitter.on("disable", disableListener)
        webSocketEmitter.on("auth", authListener)
        webSocketEmitter.on("logout", logoutListener)

        emitterListeners.push(["status:update", statusListener])
        emitterListeners.push(["enable", enableListener])
        emitterListeners.push(["disable", disableListener])
        emitterListeners.push(["auth", authListener])
        emitterListeners.push(["logout", logoutListener])
    }

    const detachEmitter = () => {
        if (!webSocketEmitter) return
        for (const [event, listener] of emitterListeners) {
            webSocketEmitter.off(event, listener)
        }
        emitterListeners.length = 0
    }

    wss.on("connection", async(socket) => {
        clients.add(socket)

        socket.on("close", () => {
            clients.delete(socket)
        })

        socket.on("message", async(message) => {
            try {
                const parsed = JSON.parse(message.toString())
                if (!SAFE_EVENTS.has(parsed.event)) return

                if (parsed.event === "ping") {
                    safeSend(socket, { event: "pong", ts: Date.now() })
                }

                if (parsed.event === "status:refresh") {
                    await pushStatus({ reason: "manual" })
                }
            } catch (err) {
                log.warn("Invalid WebSocket message", { scope: "ws", message: err.message })
            }
        })

        await pushStatus({ reason: "connection" })
    })

    attachEmitter()

    statusService?.registerBroadcaster?.((payload) => handleEmitterPayload(payload))

    const close = () => {
        detachEmitter()
        for (const socket of clients) {
            try {
                socket.terminate()
            } catch (err) {
                log.warn("Failed to terminate WebSocket client", { scope: "ws", message: err.message })
            }
        }
        clients.clear()
        wss.close()
    }

    return { wss, broadcast, close }
}

module.exports = createStatusWebSocketServer
