import api from "../../services/api"

const MAX_LOG_ENTRIES = 60
const COMMAND_RECORDING_STORAGE_KEY = "chipsy:command-recording"

const hasStorage = () => {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

const readCommandRecordingPreference = () => {
    if (!hasStorage()) return false
    try {
        const stored = window.localStorage.getItem(COMMAND_RECORDING_STORAGE_KEY)
        if (stored === null) return false
        return stored === "true"
    } catch (error) {
        console.warn("Failed to read command recording preference:", error)
        return false
    }
}

const persistCommandRecordingPreference = (enabled) => {
    if (!hasStorage()) return
    try {
        window.localStorage.setItem(COMMAND_RECORDING_STORAGE_KEY, enabled ? "true" : "false")
    } catch (error) {
        console.warn("Failed to persist command recording preference:", error)
    }
}

const normalizeMessage = (message) => {
    if (message == null) return ""
    return typeof message === "string" ? message : String(message)
}

const createEntry = ({ level = "info", message, logType = "general", timestamp = null, userId = null }) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    level,
    message: normalizeMessage(message),
    logType,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
    userId: userId ?? null
})

const shouldSaveToDatabase = () => true

export default {
    namespaced: true,
    state: () => ({
        entries: [],
        commandEntries: [],
        commandRecordingEnabled: readCommandRecordingPreference(),
        loading: false
    }),
    getters: {
        list: (state) => state.entries,
        commandList: (state) => state.commandEntries,
        isCommandRecordingEnabled: (state) => state.commandRecordingEnabled
    },
    mutations: {
        ADD_ENTRY(state, entry) {
            const targetArray = entry.logType === "command" ? state.commandEntries : state.entries
            const next = [...targetArray, entry]
            const trimmed = next.slice(-MAX_LOG_ENTRIES)

            if (entry.logType === "command") {
                state.commandEntries = trimmed
            } else {
                state.entries = trimmed
            }
        },
        SET_ENTRIES(state, { entries, logType }) {
            if (logType === "command") {
                state.commandEntries = entries
            } else {
                state.entries = entries
            }
        },
        CLEAR(state, logType = "general") {
            if (logType === "command") {
                state.commandEntries = []
            } else {
                state.entries = []
            }
        },
        SET_COMMAND_RECORDING(state, enabled) {
            state.commandRecordingEnabled = enabled
            persistCommandRecordingPreference(Boolean(enabled))
        },
        SET_LOADING(state, loading) {
            state.loading = loading
        }
    },
    actions: {
        async add({ commit, state, rootState }, payload) {
            if (!payload) return null

            const logType = payload.logType || "general"

            if (logType === "command" && !state.commandRecordingEnabled) {
                return null
            }

            const userId = payload?.userId ?? rootState.session?.user?.id ?? null
            const entry = createEntry({ ...payload, logType, userId })
            if (!entry.message) return null

            commit("ADD_ENTRY", entry)

            const canPersist = rootState.session?.permissions?.canWriteLogs
            if (shouldSaveToDatabase(entry.level, logType) && canPersist) {
                try {
                    const csrfToken = rootState.session?.csrfToken
                    if (csrfToken) {
                        await api.saveLog({
                            csrfToken,
                            level: entry.level,
                            message: entry.message,
                            logType: entry.logType,
                            userId
                        })
                    }
                } catch (error) {
                    console.error("Failed to save log to database:", error)
                }
            }

            return entry
        },

        async loadLogs({ commit }, logType = "general") {
            commit("SET_LOADING", true)
            try {
                const response = await api.getLogs({ logType, limit: MAX_LOG_ENTRIES })
                const entries = response.logs.map((log) => createEntry({
                    level: log.level,
                    message: log.message,
                    logType: log.log_type,
                    timestamp: log.created_at,
                    userId: log.user_id
                }))
                commit("SET_ENTRIES", { entries, logType })
            } catch (error) {
                console.error("Failed to load logs:", error)
            } finally {
                commit("SET_LOADING", false)
            }
        },

        clear({ commit }, logType = "general") {
            commit("CLEAR", logType)
        },

        setCommandRecording({ commit }, enabled) {
            commit("SET_COMMAND_RECORDING", enabled)
        }
    }
}
