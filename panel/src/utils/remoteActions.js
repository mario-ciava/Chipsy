import api from "../services/api"

export const REMOTE_ACTION_IDS = Object.freeze({
    RELOAD_CONFIG: "bot-reload-config",
    SYNC_COMMANDS: "bot-sync-commands",
    RUN_DIAGNOSTICS: "bot-diagnostics",
    MOD_TOOLKIT: "mod-toolkit",
    AUDIT_QUEUE: "audit-queue",
    CACHE_PURGE: "ops-cache-purge"
})

export const REMOTE_ACTION_AUDIENCE = Object.freeze({
    ADMIN: "admin",
    MODERATION: "moderation"
})

const REMOTE_ACTION_ORDER = Object.freeze({
    [REMOTE_ACTION_IDS.RELOAD_CONFIG]: 0,
    [REMOTE_ACTION_IDS.SYNC_COMMANDS]: 10,
    [REMOTE_ACTION_IDS.RUN_DIAGNOSTICS]: 20,
    [REMOTE_ACTION_IDS.CACHE_PURGE]: 30
})

const LOCAL_ACTIONS = Object.freeze([
    {
        id: REMOTE_ACTION_IDS.CACHE_PURGE,
        label: "Cache purge",
        description: "Flush stale panel caches and refresh runtime keys across all regions.",
        type: "concept",
        audience: REMOTE_ACTION_AUDIENCE.ADMIN,
        order: 40,
        pendingLabel: "Pending"
    },
    {
        id: REMOTE_ACTION_IDS.MOD_TOOLKIT,
        label: "Moderator toolkit",
        description: "Quick macros for mod-level cleanups. Rolling out soon.",
        type: "concept",
        audience: REMOTE_ACTION_AUDIENCE.MODERATION,
        order: 0,
        pendingLabel: "Soon"
    },
    {
        id: REMOTE_ACTION_IDS.AUDIT_QUEUE,
        label: "Audit queue",
        description: "Request a run-book style report across guild events.",
        type: "concept",
        audience: REMOTE_ACTION_AUDIENCE.MODERATION,
        order: 10,
        pendingLabel: "Soon"
    }
])

const normalizeAction = (action) => {
    if (!action || !action.id) {
        return null
    }
    const normalizedOrder =
        typeof action.order === "number"
            ? action.order
            : REMOTE_ACTION_ORDER[action.id]
    const audience = action.audience || REMOTE_ACTION_AUDIENCE.ADMIN
    return {
        ...action,
        audience,
        order: typeof normalizedOrder === "number" ? normalizedOrder : Number.MAX_SAFE_INTEGER
    }
}

const collectActions = (primaryActions = [], extraActions = []) => {
    const catalog = new Map()
    const pushAction = (entry, { override = false } = {}) => {
        const normalized = normalizeAction(entry)
        if (!normalized || (!override && catalog.has(normalized.id))) {
            return
        }
        catalog.set(normalized.id, normalized)
    }
    extraActions.forEach((action) => pushAction(action))
    primaryActions.forEach((action) => pushAction(action, { override: true }))
    return Array.from(catalog.values())
}

export const fetchRemoteActions = async() => {
    try {
        const response = await api.getAdminActions()
        const actions = Array.isArray(response?.actions) ? response.actions : []
        return collectActions(actions, LOCAL_ACTIONS)
    } catch (error) {
        return collectActions([], LOCAL_ACTIONS)
    }
}

export default {
    REMOTE_ACTION_IDS,
    REMOTE_ACTION_AUDIENCE,
    fetchRemoteActions
}
