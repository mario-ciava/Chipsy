import api from "../../services/api"

const initialPagination = () => ({
    page: 1,
    pageSize: 25,
    total: 0,
    totalPages: 1
})

const defaultFilters = () => ({
    search: "",
    role: "all",
    list: "all",
    minLevel: "",
    maxLevel: "",
    minBalance: "",
    maxBalance: "",
    activity: "any",
    sortBy: "last_played",
    sortDirection: "desc"
})

const initialState = () => ({
    items: [],
    pagination: initialPagination(),
    filters: defaultFilters(),
    loading: false,
    error: null,
    policy: null,
    policyLoading: false,
    policyError: null
})

const parseNumberOrEmpty = (value) => {
    if (value === null || value === undefined) return undefined
    if (value === "") return undefined
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
}

const buildRequestFilters = (filters) => {
    const payload = {}
    if (filters.search) {
        payload.search = filters.search
    }

    if (filters.role && filters.role !== "all") {
        payload.role = filters.role
    }

    if (filters.list && filters.list !== "all") {
        payload.list = filters.list
    }

    const numericKeys = ["minLevel", "maxLevel", "minBalance", "maxBalance"]
    numericKeys.forEach((key) => {
        const value = parseNumberOrEmpty(filters[key])
        if (value !== undefined) {
            payload[key] = value
        }
    })

    if (filters.activity && filters.activity !== "any") {
        payload.activity = filters.activity
    }

    payload.sortBy = filters.sortBy || "last_played"
    payload.sortDirection = filters.sortDirection || "desc"

    return payload
}

export default {
    namespaced: true,
    state: initialState,
    getters: {
        items: (state) => state.items,
        pagination: (state) => state.pagination,
        search: (state) => state.filters.search,
        filters: (state) => state.filters,
        policy: (state) => state.policy,
        isPolicyLoading: (state) => state.policyLoading
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
        SET_FILTERS(state, filters) {
            state.filters = {
                ...defaultFilters(),
                ...(filters || {})
            }
        },
        SET_LOADING(state, loading) {
            state.loading = loading
        },
        SET_ERROR(state, error) {
            state.error = error
        },
        SET_POLICY(state, policy) {
            state.policy = policy || null
        },
        SET_POLICY_LOADING(state, loading) {
            state.policyLoading = loading
        },
        SET_POLICY_ERROR(state, error) {
            state.policyError = error || null
        }
    },
    actions: {
        async fetchUsers({ commit, state, rootState, dispatch }, payload = {}) {
            if (!rootState.session.user) {
                try {
                    await dispatch("session/refreshSession", null, { root: true })
                } catch (error) {
                    // Ignore: downstream guard will surface a meaningful error
                }
            }

            if (!rootState.session.user) {
                const authError = new Error("Missing authentication context.")
                authError.code = "SESSION_MISSING"
                throw authError
            }

            const page = typeof payload.page !== "undefined" ? payload.page : state.pagination.page
            const pageSize = typeof payload.pageSize !== "undefined" ? payload.pageSize : state.pagination.pageSize
            const overrideFilters = {
                ...(typeof payload.search !== "undefined" ? { search: payload.search } : {}),
                ...(payload.filters || {})
            }
            if (typeof overrideFilters.search === "string") {
                overrideFilters.search = overrideFilters.search.trim()
            }
            const nextFilters = Object.keys(overrideFilters).length
                ? { ...state.filters, ...overrideFilters }
                : state.filters

            commit("SET_LOADING", true)
            commit("SET_ERROR", null)

            try {
                const response = await api.listUsers({
                    page,
                    pageSize,
                    ...buildRequestFilters(nextFilters)
                })

                commit("SET_ITEMS", response.items || [])
                commit("SET_PAGINATION", response.pagination || initialPagination())
                commit("SET_FILTERS", nextFilters)
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
                filters: state.filters
            })
        },
        async fetchPolicy({ commit }) {
            commit("SET_POLICY_LOADING", true)
            commit("SET_POLICY_ERROR", null)
            try {
                const policy = await api.getAccessPolicy()
                commit("SET_POLICY", policy)
                return policy
            } catch (error) {
                commit("SET_POLICY_ERROR", error)
                throw error
            } finally {
                commit("SET_POLICY_LOADING", false)
            }
        },
        async updatePolicy({ commit }, { csrfToken, enforceWhitelist, enforceBlacklist, enforceQuarantine }) {
            if (
                typeof enforceWhitelist !== "boolean"
                && typeof enforceBlacklist !== "boolean"
                && typeof enforceQuarantine !== "boolean"
            ) {
                throw new Error("Missing policy update flags")
            }
            commit("SET_POLICY_LOADING", true)
            commit("SET_POLICY_ERROR", null)
            try {
                const policy = await api.updateAccessPolicy({
                    csrfToken,
                    enforceWhitelist,
                    enforceBlacklist,
                    enforceQuarantine
                })
                commit("SET_POLICY", policy)
                return policy
            } catch (error) {
                commit("SET_POLICY_ERROR", error)
                throw error
            } finally {
                commit("SET_POLICY_LOADING", false)
            }
        }
    }
}
