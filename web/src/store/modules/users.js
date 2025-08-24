import api from "../../services/api"

const initialPagination = () => ({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1
})

const initialState = () => ({
    items: [],
    pagination: initialPagination(),
    search: "",
    loading: false,
    error: null
})

export default {
    namespaced: true,
    state: initialState,
    getters: {
        items: (state) => state.items,
        pagination: (state) => state.pagination,
        search: (state) => state.search
    },
    mutations: {
        SET_ITEMS(state, items) {
            state.items = items
        },
        SET_PAGINATION(state, pagination) {
            state.pagination = {
                ...initialPagination(),
                ...pagination
            }
        },
        SET_SEARCH(state, search) {
            state.search = search
        },
        SET_LOADING(state, loading) {
            state.loading = loading
        },
        SET_ERROR(state, error) {
            state.error = error
        }
    },
    actions: {
        async fetchUsers({ commit, state, rootState }, payload = {}) {
            if (!rootState.session.user) {
                throw new Error("Missing authentication context.")
            }

            const page = typeof payload.page !== "undefined" ? payload.page : state.pagination.page
            const pageSize = typeof payload.pageSize !== "undefined" ? payload.pageSize : state.pagination.pageSize
            const search = typeof payload.search !== "undefined" ? payload.search : state.search

            commit("SET_LOADING", true)
            commit("SET_ERROR", null)

            try {
                const response = await api.listUsers({
                    params: { page, pageSize, search }
                })

                commit("SET_ITEMS", response.items || [])
                commit("SET_PAGINATION", response.pagination || initialPagination())
                commit("SET_SEARCH", search ? search : "")
                return response
            } catch (error) {
                commit("SET_ERROR", error)
                throw error
            } finally {
                commit("SET_LOADING", false)
            }
        },

        async refresh({ dispatch, state }) {
            return dispatch("fetchUsers", {
                page: state.pagination.page,
                pageSize: state.pagination.pageSize,
                search: state.search
            })
        }
    }
}
