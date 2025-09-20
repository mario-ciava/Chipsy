import api from "../../services/api"

let bootstrapPromise = null

const initialState = () => ({
    user: null,
    csrfToken: null,
    clientConfig: null,
    loading: false,
    error: null,
    initialized: false
})

export default {
    namespaced: true,
    state: initialState,
    getters: {
        isAuthenticated: (state) => Boolean(state.user),
        isAdmin: (state) => Boolean(state.user && state.user.isAdmin),
        csrfToken: (state) => state.csrfToken,
        user: (state) => state.user
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

        async completeLogin({ commit, dispatch }, code) {
            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            try {
                await api.exchangeCode(code)
                await dispatch("refreshSession")
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
                commit("SET_INITIALIZED", true)
            }
        },

        async refreshSession({ commit }) {
            commit("SET_ERROR", null)
            try {
                const user = await api.getCurrentUser()
                let clientConfig = null

                if (user && user.isAdmin) {
                    try {
                        clientConfig = await api.getClientConfig()
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to load client configuration", error)
                    }
                }

                commit("SET_USER", user)
                commit("SET_CLIENT_CONFIG", clientConfig)
                const csrfToken = clientConfig?.csrfToken || user?.csrfToken || null
                commit("SET_CSRF_TOKEN", csrfToken)

                return { user, clientConfig }
            } catch (error) {
                const status = error?.response?.status
                if (status === 400 || status === 401) {
                    commit("SET_USER", null)
                    commit("SET_CLIENT_CONFIG", null)
                    commit("SET_CSRF_TOKEN", null)
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
                commit("RESET_STATE")
                commit("SET_INITIALIZED", true)
            }
        },

        clear({ commit }) {
            commit("RESET_STATE")
        }
    }
}
