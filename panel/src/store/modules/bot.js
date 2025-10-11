import api from "../../services/api"

const initialState = () => ({
    status: null,
    loading: false,
    error: null
})

export default {
    namespaced: true,
    state: initialState,
    getters: {
        isEnabled: (state) => Boolean(state.status && state.status.enabled),
        status: (state) => state.status
    },
    mutations: {
        SET_STATUS(state, status) {
            state.status = status
        },
        SET_LOADING(state, loading) {
            state.loading = loading
        },
        SET_ERROR(state, error) {
            state.error = error
        }
    },
    actions: {
        async fetchStatus({ commit, rootState, dispatch }) {
            if (!rootState.session.user) {
                try {
                    await dispatch("session/refreshSession", null, { root: true })
                } catch (error) {
                    // Ignore, follow-up guard will exit early if still unauthenticated
                }
            }

            if (!rootState.session.user) return null

            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            try {
                const status = await api.getBotStatus()
                commit("SET_STATUS", status)
                return status
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
            }
        },

        async updateEnabled({ commit, rootState }, enabled) {
            const csrfToken = rootState.session.csrfToken
            if (!csrfToken) {
                throw new Error("Missing authentication context.")
            }

            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            try {
                commit("SET_STATUS", {
                    ...(rootState.bot.status || {}),
                    enabled,
                    updatedAt: new Date().toISOString()
                })
                const status = await api.toggleBot({ csrfToken, enabled })
                commit("SET_STATUS", status)
                return status
            } catch (error) {
                const is409 = error.response?.status === 409 || error.message?.includes("409")
                if (is409) {
                    const conflictError = new Error("An operation is already in progress. Wait up to 10 seconds and try again.")
                    conflictError.code = 409
                    commit("SET_ERROR", conflictError)
                    throw conflictError
                }
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
            }
        }
    }
}
