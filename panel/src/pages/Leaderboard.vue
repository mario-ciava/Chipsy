<template>
    <div class="chip-stack leaderboard-page">
        <LeaderboardTop />

        <section class="chip-card leaderboard-page__panel" aria-labelledby="leaderboardHeading">
            <header class="chip-card__header leaderboard-page__header">
                <div class="chip-stack gap-5 leaderboard-page__intro">
                    <p class="chip-eyebrow">Full leaderboard</p>
                    <h1 id="leaderboardHeading" class="chip-card__title leaderboard-page__title">All contenders</h1>
                    <p class="chip-card__subtitle chip-card__subtitle--tight leaderboard-page__subtitle">
                        The full ranking is updated live. Use the search field to jump to a player when you're logged in.
                    </p>
                    <div class="leaderboard-page__intro-actions">
                        <button class="chip-btn chip-btn-ghost" type="button" @click="refresh">
                            Sync data
                        </button>
                    </div>
                    <div class="leaderboard-page__stats" role="list">
                        <article class="chip-stat chip-stat--inline" role="listitem">
                            <span class="chip-stat__label">Active metric</span>
                            <span class="chip-stat__value">{{ activeMetricLabel }}</span>
                            <span class="leaderboard-page__stat-hint">Switch anytime</span>
                            <span class="chip-pill chip-pill-info leaderboard-page__stat-pill">Live</span>
                        </article>
                        <article class="chip-stat chip-stat--inline" role="listitem">
                            <span class="chip-stat__label">Visible entries</span>
                            <span class="chip-stat__value">{{ leaderboardTotals.visible }}</span>
                            <span class="leaderboard-page__stat-hint">of {{ leaderboardTotals.total }}</span>
                        </article>
                        <article v-if="viewerRank" class="chip-stat chip-stat--inline leaderboard-page__stat-viewer" role="listitem">
                            <span class="chip-stat__label">Your position</span>
                            <span class="chip-stat__value">#{{ viewerRank.rank }}</span>
                            <span class="leaderboard-page__stat-hint">{{ activeMetricLabel }}</span>
                            <span class="chip-pill chip-pill-success leaderboard-page__stat-pill">Tracking</span>
                        </article>
                    </div>
                </div>
                <div class="leaderboard-page__metric-column" role="group" aria-label="Leaderboard metric selector">
                    <div class="leaderboard-page__metric-switch">
                        <button
                            v-for="option in displayMetricOptions"
                            :key="option.id"
                            class="chip-pill leaderboard-page__metric leaderboard-page__metric-pill"
                            :class="{ 'leaderboard-page__metric--active': option.id === activeMetric }"
                            type="button"
                            @click="setMetric(option.id)"
                        >
                            <span class="leaderboard-page__metric-icon" aria-hidden="true">{{ option.icon }}</span>
                            <div class="leaderboard-page__metric-copy">
                                <span class="leaderboard-page__metric-label">{{ option.label }}</span>
                                <span v-if="option.description" class="leaderboard-page__metric-hint">
                                    {{ option.description }}
                                </span>
                            </div>
                        </button>
                    </div>
                </div>
            </header>

            <div class="chip-divider chip-divider--strong my-1.5"></div>

            <div class="leaderboard-page__controls">
                <label class="chip-field leaderboard-page__search">
                    <span class="chip-field__label">Search players</span>
                    <input
                        v-model="searchQuery"
                        type="search"
                        class="chip-field__input"
                        :placeholder="searchPlaceholder"
                        :disabled="!canSearch"
                    />
                </label>
            </div>

            <p v-if="!canSearch" class="leaderboard-page__notice">
                Log in to unlock search and advanced stats.
            </p>
            <div v-if="tableError" class="leaderboard-page__alert chip-notice chip-notice-error" role="status">
                {{ tableError }}
            </div>

            <div class="leaderboard-page__table" role="table" aria-live="polite">
                <div class="leaderboard-page__table-head" role="row">
                    <span class="leaderboard-page__head-col">Rank</span>
                    <span class="leaderboard-page__head-col">Player</span>
                    <span class="leaderboard-page__head-col">Metric</span>
                    <span class="leaderboard-page__head-col">Momentum</span>
                    <span class="leaderboard-page__head-col">Snapshot</span>
                    <span class="leaderboard-page__head-col sr-only">Status</span>
                </div>
                <ul class="leaderboard-page__table-body" role="rowgroup">
                    <li v-if="tableLoading" class="leaderboard-page__state">
                        <span class="loader" aria-hidden="true"></span>
                        <p>Fetching rankings…</p>
                    </li>
                    <li v-else-if="!entries.length" class="leaderboard-page__state">
                        <p class="leaderboard-page__state-title">{{ emptyState.title }}</p>
                        <p class="leaderboard-page__state-copy">{{ emptyState.description }}</p>
                    </li>
                    <template v-else>
                        <LeaderboardRow
                            v-for="entry in entries"
                            :key="entry.rank"
                            :entry="entry"
                            :show-stats="canSearch"
                        />
                    </template>
                </ul>
            </div>

            <footer class="leaderboard-page__footer chip-pagination">
                <button
                    class="chip-btn chip-btn-ghost"
                    type="button"
                    :disabled="pagination.page === 1"
                    @click="setPage(pagination.page - 1)"
                >
                    Previous
                </button>
                <span class="chip-pagination__meta">Page {{ pagination.page }} / {{ totalPages }}</span>
                <button
                    class="chip-btn chip-btn-ghost"
                    type="button"
                    :disabled="pagination.page >= totalPages"
                    @click="setPage(pagination.page + 1)"
                >
                    Next
                </button>
            </footer>
        </section>
    </div>
</template>

<script>
import { defineComponent, computed, watch } from "vue"
import store from "../store"
import LeaderboardTop from "../components/LeaderboardTop.vue"
import LeaderboardRow from "../components/LeaderboardRow.vue"
import useLeaderboard from "../composables/useLeaderboard"

export default defineComponent({
    name: "LeaderboardPage",
    components: {
        LeaderboardTop,
        LeaderboardRow
    },
    setup() {
        const leaderboardStore = useLeaderboard({
            canSearch: store.getters["session/isAuthenticated"]
        })

        const isAuthenticated = computed(() => store.getters["session/isAuthenticated"])

        watch(isAuthenticated, (value) => {
            leaderboardStore.canSearch.value = Boolean(value)
            if (!value) {
                leaderboardStore.search.value = ""
            }
        }, { immediate: true })

        const entries = computed(() => leaderboardStore.tableItems.value || [])
        const tableLoading = computed(() => leaderboardStore.tableLoading.value)
        const metricOptions = computed(() => leaderboardStore.metricOptions.value || [])
        const metricCopyMap = {
            "net-profit": {
                icon: "📈",
                description: "Cumulative winnings"
            },
            chips: {
                icon: "🪙",
                description: "Live bankroll"
            },
            "win-rate": {
                icon: "🎯",
                description: "Consistency score"
            }
        }
        const displayMetricOptions = computed(() => metricOptions.value.map((option) => {
            const copy = metricCopyMap[option.id] || {}
            return {
                ...option,
                icon: copy.icon || option.icon || "⭐️",
                description: copy.description || option.description || ""
            }
        }))
        const activeMetric = computed(() => leaderboardStore.metric.value)
        const tableMeta = computed(() => leaderboardStore.tableMeta.value || null)
        const topMeta = computed(() => leaderboardStore.topMeta.value || null)
        const canSearch = computed(() => leaderboardStore.canSearch.value)
        const viewerRank = computed(() => leaderboardStore.viewer.value || null)
        const searchQuery = computed({
            get: () => leaderboardStore.search.value,
            set: (value) => {
                leaderboardStore.search.value = value
            }
        })
        const emptyState = computed(() => tableMeta.value?.emptyState || topMeta.value?.emptyState || {
            title: "Leaderboard warming up",
            description: "Once players start competing, rankings will appear here."
        })
        const searchPlaceholder = computed(() => (canSearch.value ? "Search by Discord id or name" : "Login required to search"))
        const leaderboardTotals = computed(() => {
            const visible = entries.value.length
            const total = typeof tableMeta.value?.total === "number" && tableMeta.value.total > 0 ? tableMeta.value.total : visible
            return {
                visible,
                total
            }
        })
        const activeMetricLabel = computed(() => {
            const current = activeMetric.value
            const match = metricOptions.value.find((option) => option.id === current)
            return match?.label || "current metric"
        })
        const totalPages = computed(() => tableMeta.value?.totalPages || 1)
        const tableError = computed(() => leaderboardStore.tableError.value)

        const setMetric = (metricId) => {
            if (metricId) {
                leaderboardStore.setMetric(metricId)
            }
        }

        const setPage = (page) => {
            leaderboardStore.setPage(page)
        }

        const refresh = () => leaderboardStore.refresh()

        return {
            entries,
            tableLoading,
            metricOptions,
            displayMetricOptions,
            activeMetric,
            activeMetricLabel,
            emptyState,
            pagination: leaderboardStore.pagination,
            canSearch,
            viewerRank,
            leaderboardTotals,
            searchQuery,
            searchPlaceholder,
            totalPages,
            setMetric,
            setPage,
            refresh,
            tableError
        }
    }
})
</script>
