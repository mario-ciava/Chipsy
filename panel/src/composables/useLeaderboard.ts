import { ref, reactive, computed, watch } from "vue"
import api from "../services/api"

type LeaderboardMetricId = string

type LeaderboardMeta = {
    limit?: number
    offset?: number
    page?: number
    pageSize?: number
    total?: number
    totalPages?: number
    metrics?: Array<Record<string, unknown>>
    viewer?: Record<string, unknown> | null
    [key: string]: unknown
} | null

type LeaderboardEntry = Record<string, unknown>

interface UseLeaderboardOptions {
    metric?: LeaderboardMetricId
    pageSize?: number
    debounceMs?: number
    withTop?: boolean
    withTable?: boolean
    canSearch?: boolean
}

const DEFAULT_METRIC = "net-profit"

export const useLeaderboard = (options: UseLeaderboardOptions = {}) => {
    const metric = ref<LeaderboardMetricId>(options.metric || DEFAULT_METRIC)
    const metricOptions = ref<Array<Record<string, unknown>>>([])

    const topState = reactive({
        loading: false,
        items: [] as LeaderboardEntry[],
        meta: null as LeaderboardMeta
    })

    const tableState = reactive({
        loading: false,
        items: [] as LeaderboardEntry[],
        meta: null as LeaderboardMeta
    })

    const pagination = reactive({
        page: 1,
        pageSize: Math.max(1, Number(options.pageSize) || 25)
    })

    const search = ref("")
    const debouncedSearch = ref("")
    const canSearch = ref(Boolean(options.canSearch ?? true))
    const viewer = ref<Record<string, unknown> | null>(null)

    const withTop = options.withTop !== false
    const withTable = options.withTable !== false
    const debounceMs = Math.max(100, Number(options.debounceMs) || 400)

    const topCache = new Map<string, { items: LeaderboardEntry[]; meta: LeaderboardMeta }>()
    const tableCache = new Map<string, { items: LeaderboardEntry[]; meta: LeaderboardMeta }>()

    const assignTop = (payload: { items?: LeaderboardEntry[]; meta?: LeaderboardMeta }) => {
        topState.items = payload.items || []
        topState.meta = payload.meta || null
    }

    const assignTable = (payload: { items?: LeaderboardEntry[]; meta?: LeaderboardMeta }) => {
        tableState.items = payload.items || []
        tableState.meta = payload.meta || null
    }

    const syncViewer = (payload: LeaderboardMeta | null) => {
        if (payload?.viewer) {
            viewer.value = payload.viewer as Record<string, unknown>
        }
    }

    const loadTop = async(force = false) => {
        if (!withTop) return
        const cacheKey = metric.value
        if (!force && topCache.has(cacheKey)) {
            assignTop(topCache.get(cacheKey) || {})
            return
        }
        topState.loading = true
        try {
            const response = await api.getLeaderboardTop({ metric: cacheKey })
            assignTop({ items: response.items, meta: response.meta })
            metricOptions.value = response.meta?.metrics || metricOptions.value
            syncViewer(response.meta || null)
            topCache.set(cacheKey, { items: response.items || [], meta: response.meta || null })
        } catch (error) {
            assignTop({ items: [], meta: null })
            throw error
        } finally {
            topState.loading = false
        }
    }

    const loadTable = async(force = false) => {
        if (!withTable) {
            return
        }
        const cacheKey = `${metric.value}:${pagination.page}:${debouncedSearch.value}`
        if (!force && tableCache.has(cacheKey)) {
            assignTable(tableCache.get(cacheKey) || {})
            return
        }
        tableState.loading = true
        try {
            const response = await api.listLeaderboard({
                metric: metric.value,
                page: pagination.page,
                pageSize: pagination.pageSize,
                search: canSearch.value ? debouncedSearch.value : undefined
            })
            assignTable({ items: response.items, meta: response.meta })
            syncViewer(response.meta || null)
            tableCache.set(cacheKey, { items: response.items || [], meta: response.meta || null })
        } catch (error) {
            assignTable({ items: [], meta: null })
            throw error
        } finally {
            tableState.loading = false
        }
    }

    const refreshViewerPosition = async() => {
        try {
            const response = await api.getLeaderboardMe({ metric: metric.value })
            if (response?.entry) {
                viewer.value = {
                    rank: response.rank,
                    entry: response.entry
                }
            }
        } catch (error) {
            viewer.value = null
        }
    }

    const refresh = async() => {
        const tasks: Array<Promise<unknown>> = []
        if (withTop) {
            tasks.push(loadTop(true))
        }
        if (withTable) {
            tasks.push(loadTable(true))
        }
        tasks.push(refreshViewerPosition())
        await Promise.all(tasks)
    }

    const setPage = (page: number) => {
        if (!withTable) return
        pagination.page = Math.max(1, page)
        loadTable()
    }

    let searchTimeout: ReturnType<typeof setTimeout> | null = null
    watch(search, (value) => {
        if (!withTable || !canSearch.value) return
        if (searchTimeout) {
            clearTimeout(searchTimeout)
        }
        searchTimeout = setTimeout(() => {
            debouncedSearch.value = value.trim()
        }, debounceMs)
    })

    watch(debouncedSearch, () => {
        if (!withTable) return
        pagination.page = 1
        loadTable(true)
    })

    watch(metric, () => {
        pagination.page = 1
        if (withTop) {
            loadTop(true)
        }
        if (withTable) {
            loadTable(true)
        }
        refreshViewerPosition()
    })

    if (withTop) {
        loadTop()
    }
    if (withTable) {
        loadTable()
    }
    refreshViewerPosition()

    return {
        metric,
        metricOptions,
        topItems: computed(() => topState.items),
        topMeta: computed(() => topState.meta),
        topLoading: computed(() => topState.loading),
        tableItems: computed(() => tableState.items),
        tableMeta: computed(() => tableState.meta),
        tableLoading: computed(() => tableState.loading),
        pagination,
        search,
        canSearch,
        viewer,
        setPage,
        refresh,
        loadTop,
        loadTable,
        setMetric: (nextMetric: string) => {
            if (nextMetric && nextMetric !== metric.value) {
                metric.value = nextMetric
            }
        }
    }
}

export default useLeaderboard
