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
        async fetchStatus({ commit, rootState }) {
            const token = rootState.session.token
            if (!token) return null

            commit("SET_LOADING", true)
            commit("SET_ERROR", null)
            try {
                const status = await api.getBotStatus(token)
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
            const token = rootState.session.token
            const csrfToken = rootState.session.csrfToken
            if (!token || !csrfToken) {
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
                const status = await api.toggleBot({ token, csrfToken, enabled })
                commit("SET_STATUS", status)
                return status
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
            }
        }
    }
}
