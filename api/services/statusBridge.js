const EventEmitter = require("events")
const logger = require("../../shared/logger")
const { botRpc } = require("../../config")

const createStatusBridge = ({
    rpcClient,
    webSocket,
    pollIntervalMs = botRpc.pollIntervalMs || 5000
} = {}) => {
    if (!rpcClient) {
        throw new Error("rpcClient is required to create the status bridge")
    }

    const broadcaster = new EventEmitter()
    let lastStatus = null
    let pollTimer = null

    const emitStatus = (status, meta = {}) => {
        if (!status) return
        lastStatus = status
        const payload = { status, meta }
        try {
            webSocket?.emit?.("status:update", payload)
        } catch (error) {
            logger.warn("Failed to forward status:update to websocket emitter", {
                scope: "statusBridge",
                message: error.message
            })
        }
        broadcaster.emit("status:update", payload)
    }

    const getBotStatus = async(options = {}) => {
        if (!options.forceRefresh && lastStatus) {
            return lastStatus
        }
        const status = await rpcClient.getStatus()
        emitStatus(status, { reason: options.reason || "fetch" })
        return status
    }

    const refreshBotStatus = async(meta = {}) => {
        const status = await rpcClient.refreshStatus()
        emitStatus(status, { reason: meta.reason || "refresh" })
        return status
    }

    const getGuildSnapshot = async(guildId, options = {}) => {
        if (!guildId) return null
        if (options.forceRefresh) {
            await rpcClient.invalidateGuildSnapshot(guildId)
        }
        return rpcClient.getGuildSnapshot(guildId)
    }

    const invalidateGuildSnapshot = async(guildId) => {
        if (!guildId) return
        await rpcClient.invalidateGuildSnapshot(guildId)
    }

    const registerBroadcaster = (fn) => {
        if (typeof fn !== "function") return
        broadcaster.on("status:update", fn)
    }

    const broadcastStatus = (status, meta = {}) => {
        emitStatus(status, meta)
    }

    if (pollIntervalMs > 0) {
        const poll = async() => {
            try {
                await getBotStatus({ reason: "poll" })
            } catch (error) {
                logger.warn("Status poll failed", {
                    scope: "statusBridge",
                    message: error.message
                })
            }
        }
        pollTimer = setInterval(poll, pollIntervalMs)
        if (typeof pollTimer.unref === "function") {
            pollTimer.unref()
        }
        // kick off immediately
        poll().catch(() => null)
    }

    return {
        getBotStatus,
        refreshBotStatus,
        getGuildSnapshot,
        invalidateGuildSnapshot,
        broadcastStatus,
        registerBroadcaster
    }
}

module.exports = createStatusBridge
