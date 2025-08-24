import Vue from "vue"
import api from "../../services/api"

const TOKEN_COOKIE = "_token"
const TOKEN_STORAGE_KEY = "chipsy_token"

const setTokenCookie = (token) => {
    if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY)
    }

    if (!Vue.$cookies) return
    if (token) {
        Vue.$cookies.set(TOKEN_COOKIE, token, "7d", "/", "", false)
    } else {
        Vue.$cookies.remove(TOKEN_COOKIE)
    }
}

const getTokenFromCookie = () => {
    let token = null
    if (Vue.$cookies) {
        token = Vue.$cookies.get(TOKEN_COOKIE) || null
    }
    if (!token) {
        token = localStorage.getItem(TOKEN_STORAGE_KEY) || null
    }
    return token
}

const initialState = () => ({
    token: null,
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
        isAuthenticated: (state) => Boolean(state.token),
        isAdmin: (state) => Boolean(state.user && state.user.isAdmin),
        token: (state) => state.token,
        csrfToken: (state) => state.csrfToken,
        user: (state) => state.user
    },
    mutations: {
        SET_TOKEN(state, token) {
            state.token = token
        },
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
            if (state.initialized) return

            const token = getTokenFromCookie()
            if (token) {
                commit("SET_TOKEN", token)
                try {
                    await dispatch("refreshSession")
                } catch (error) {
                    commit("SET_ERROR", error)
                }
            }

            commit("SET_INITIALIZED", true)
        },

        async completeLogin({ commit, dispatch }, code) {
            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            try {
                const tokenData = await api.exchangeCode(code)
                if (tokenData && tokenData.access_token) {
                    commit("SET_TOKEN", tokenData.access_token)
                    setTokenCookie(tokenData.access_token)
                    await dispatch("refreshSession")
                } else {
                    throw new Error("Invalid token response from server.")
                }
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
                commit("SET_INITIALIZED", true)
            }
        },

        async refreshSession({ state, commit }) {
            if (!state.token) return null

            commit("SET_ERROR", null)
            try {
                const user = await api.getCurrentUser(state.token)
                let clientConfig = null

                if (user && user.isAdmin) {
                    try {
                        clientConfig = await api.getClientConfig(state.token)
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to load client configuration", error)
                    }
                }

                commit("SET_USER", user)
                commit("SET_CLIENT_CONFIG", clientConfig)
                if (clientConfig && clientConfig.csrfToken) {
                    commit("SET_CSRF_TOKEN", clientConfig.csrfToken)
                }

                return { user, clientConfig }
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            }
        },

        async logout({ state, commit }) {
            try {
                if (state.token) {
                    await api.logout({
                        token: state.token,
                        user: state.user
                    })
                }
            } catch (error) {
                // Log locally but proceed with clearing state
                // eslint-disable-next-line no-console
                console.warn("Failed to notify API about logout", error)
            } finally {
                setTokenCookie(null)
                commit("RESET_STATE")
                commit("SET_INITIALIZED", true)
            }
        }
    }
}
