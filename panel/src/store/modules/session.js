import api, { applyRuntimeConfig } from "../../services/api"
import { getPanelConfig as resolvePanelConfig } from "../../config/panelDefaults"

let bootstrapPromise = null

const defaultPermissions = () => ({
    role: "USER",
    isMaster: false,
    isAdmin: false,
    isModerator: false,
    canAccessPanel: false,
    canViewLogs: false,
    canManageRoles: false,
    canAssignAdmin: false,
    canAssignModerator: false,
    canManageLists: false,
    canWriteLogs: false
})

const SESSION_HINT_KEY = "chipsy:sessionHint"

const safeSessionStorage = () => {
    if (typeof window === "undefined" || !window.sessionStorage) {
        return null
    }
    try {
        return window.sessionStorage
    } catch (error) {
        return null
    }
}

const hasSessionHint = () => {
    const storage = safeSessionStorage()
    if (!storage) return false
    try {
        return storage.getItem(SESSION_HINT_KEY) === "1"
    } catch (error) {
        return false
    }
}

const setSessionHint = (value) => {
    const storage = safeSessionStorage()
    if (!storage) return
    try {
        if (value) {
            storage.setItem(SESSION_HINT_KEY, "1")
        } else {
            storage.removeItem(SESSION_HINT_KEY)
        }
    } catch (error) {
        // ignore
    }
}

const initialState = () => ({
    user: null,
    csrfToken: null,
    clientConfig: null,
    permissions: defaultPermissions(),
    loading: false,
    error: null,
    initialized: false
})

export default {
    namespaced: true,
    state: initialState,
    getters: {
        isAuthenticated: (state) => Boolean(state.user),
        isAdmin: (state) => Boolean(state.permissions?.canAccessPanel),
        isModerator: (state) => Boolean(state.permissions?.canViewLogs),
        csrfToken: (state) => state.csrfToken,
        user: (state) => state.user,
        role: (state) => state.user?.role || state.permissions.role,
        permissions: (state) => state.permissions,
        canViewLogs: (state) => Boolean(state.permissions?.canViewLogs),
        canManageRoles: (state) => Boolean(state.permissions?.canManageRoles),
        canManageLists: (state) => Boolean(state.permissions?.canManageLists),
        canWriteLogs: (state) => Boolean(state.permissions?.canWriteLogs),
        canAssignAdmin: (state) => Boolean(state.permissions?.canAssignAdmin),
        canAssignModerator: (state) => Boolean(state.permissions?.canAssignModerator),
        panelConfig: (state) => (state.clientConfig?.panel
            ? resolvePanelConfig(state.clientConfig.panel)
            : resolvePanelConfig())
    },
    mutations: {
        SET_USER(state, user) {
            state.user = user
        },
        SET_CSRF_TOKEN(state, token) {
            state.csrfToken = token
        },
        SET_CLIENT_CONFIG(state, config) {
            state.clientConfig = config
        },
        SET_PERMISSIONS(state, permissions) {
            state.permissions = {
                ...defaultPermissions(),
                ...(permissions || {})
            }
        },
        SET_LOADING(state, loading) {
            state.loading = loading
        },
        SET_ERROR(state, error) {
            state.error = error
        },
        SET_INITIALIZED(state, initialized) {
            state.initialized = initialized
        },
        RESET_STATE(state) {
            Object.assign(state, initialState())
        }
    },
    actions: {
        async bootstrap({ commit, dispatch, state }) {
            if (state.initialized) {
                return Promise.resolve()
            }

            if (bootstrapPromise) {
                return bootstrapPromise
            }

            bootstrapPromise = (async() => {
                try {
                    await dispatch("refreshSession")
                } catch (error) {
                    commit("SET_ERROR", error)
                } finally {
                    commit("SET_INITIALIZED", true)
                    bootstrapPromise = null
                }
            })()

            return bootstrapPromise
        },

        async completeLogin({ commit, dispatch }, payload) {
            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            const normalized = typeof payload === "string" ? { code: payload } : (payload || {})
            const { code, state } = normalized
            try {
                await api.exchangeCode(code, state)
                await dispatch("refreshSession", { force: true })
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
                commit("SET_INITIALIZED", true)
            }
        },

        async refreshSession({ commit }, options = {}) {
            const forceRefresh = Boolean(options?.force)
            if (!forceRefresh && !hasSessionHint()) {
                commit("SET_USER", null)
                commit("SET_CLIENT_CONFIG", null)
                commit("SET_CSRF_TOKEN", null)
                commit("SET_PERMISSIONS", defaultPermissions())
                applyRuntimeConfig()
                return null
            }
            commit("SET_ERROR", null)
            try {
                const user = await api.getCurrentUser()
                if (user) {
                    setSessionHint(true)
                }
                let clientConfig = null

                const permissions = user?.permissions || defaultPermissions()

                if (user) {
                    commit("SET_PERMISSIONS", permissions)
                } else {
                    commit("SET_PERMISSIONS", defaultPermissions())
                }

                if (user && permissions.canAccessPanel) {
                    try {
                        clientConfig = await api.getClientConfig()
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to load client configuration", error)
                    }
                }

                if (clientConfig) {
                    const sanitizedPanel = resolvePanelConfig(clientConfig.panel)
                    applyRuntimeConfig(sanitizedPanel)
                    clientConfig = {
                        ...clientConfig,
                        panel: sanitizedPanel
                    }
                } else {
                    applyRuntimeConfig()
                }

                commit("SET_USER", user)
                commit("SET_CLIENT_CONFIG", clientConfig)
                const csrfToken = clientConfig?.csrfToken || user?.csrfToken || null
                commit("SET_CSRF_TOKEN", csrfToken)

                return { user, clientConfig }
            } catch (error) {
                const status = error?.response?.status
                if (status === 400 || status === 401) {
                    setSessionHint(false)
                    commit("SET_USER", null)
                    commit("SET_CLIENT_CONFIG", null)
                    commit("SET_CSRF_TOKEN", null)
                    commit("SET_PERMISSIONS", defaultPermissions())
                    return null
                }

                commit("SET_ERROR", error)
                throw error
            }
        },

        async logout({ state, commit }) {
            try {
                if (state.user && state.csrfToken) {
                    await api.logout({
                        csrfToken: state.csrfToken,
                        user: state.user
                    })
                }
            } catch (error) {
                // Log locally but proceed with clearing state
                // eslint-disable-next-line no-console
                console.warn("Failed to notify API about logout", error)
            } finally {
                setSessionHint(false)
                commit("RESET_STATE")
                commit("SET_INITIALIZED", true)
                applyRuntimeConfig()
            }
        },

        clear({ commit }) {
            commit("RESET_STATE")
        }
    }
}
