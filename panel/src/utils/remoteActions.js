import api from "../services/api"

export const REMOTE_ACTION_IDS = Object.freeze({
    RELOAD_CONFIG: "bot-reload-config",
    SYNC_COMMANDS: "bot-sync-commands",
    RUN_DIAGNOSTICS: "bot-diagnostics",
    MOD_TOOLKIT: "mod-toolkit",
    AUDIT_QUEUE: "audit-queue"
})

const CONCEPT_ACTIONS = Object.freeze([
    {
        id: REMOTE_ACTION_IDS.MOD_TOOLKIT,
        label: "Moderator toolkit",
        description: "Quick macros for mod-level cleanups. Rolling out soon.",
        type: "concept"
    },
    {
        id: REMOTE_ACTION_IDS.AUDIT_QUEUE,
        label: "Audit queue",
        description: "Request a run-book style report across guild events.",
        type: "concept"
    }
])

export const fetchRemoteActions = async() => {
    try {
        const response = await api.getAdminActions()
        const actions = Array.isArray(response?.actions) ? response.actions : []
        return [...actions, ...CONCEPT_ACTIONS]
    } catch (error) {
        return [...CONCEPT_ACTIONS]
    }
}

export default {
    REMOTE_ACTION_IDS,
    fetchRemoteActions
}
