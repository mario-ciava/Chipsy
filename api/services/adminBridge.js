const logger = require("../../shared/logger")

const createAdminBridge = ({
    rpcClient,
    webSocket,
    statusService
} = {}) => {
    if (!rpcClient) {
        throw new Error("rpcClient is required to create the admin bridge")
    }

    const emitToggleEvent = (enabled) => {
        const event = enabled ? "enable" : "disable"
        try {
            webSocket?.emit?.(event)
        } catch (error) {
            logger.warn("Failed to emit toggle event on websocket bridge", {
                scope: "adminBridge",
                message: error.message
            })
        }
    }

    const refreshStatus = async(reason) => {
        if (!statusService) return null
        try {
            return await statusService.refreshBotStatus({ reason })
        } catch (error) {
            logger.warn("Failed to refresh status after admin action", {
                scope: "adminBridge",
                message: error.message
            })
            return null
        }
    }

    const setBotEnabled = async(enabled, meta = {}) => {
        const status = await rpcClient.setBotEnabled(enabled, meta)
        emitToggleEvent(enabled)
        await refreshStatus(meta.reason || "admin:toggle")
        return status
    }

    return {
        async getStatus(meta = {}) {
            if (meta.forceRefresh) {
                return statusService?.refreshBotStatus(meta) ?? rpcClient.refreshStatus()
            }
            if (statusService) {
                return statusService.getBotStatus(meta)
            }
            return rpcClient.getStatus()
        },
        setBotEnabled,
        getClientConfig: () => rpcClient.getClientConfig(),
        getGuild: (guildId) => rpcClient.getGuild(guildId),
        leaveGuild: (guildId, meta = {}) => rpcClient.leaveGuild(guildId, meta),
        completeInvite: (payload) => rpcClient.completeInvite(payload),
        executeAction: (actionId, meta = {}) => rpcClient.executeAction(actionId, meta),
        listActions: () => rpcClient.listActions(),
        listTables: () => rpcClient.listTables(),
        controlTable: ({ tableId, action, actor }) => rpcClient.controlTable(tableId, { action, actor }),
        createLog: (payload) => rpcClient.createLog(payload),
        getLogs: (params) => rpcClient.getLogs(params),
        cleanupLogs: () => rpcClient.cleanupLogs()
    }
}

module.exports = createAdminBridge
