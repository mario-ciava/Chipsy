<template>
    <div class="chip-stack leaderboard-page">
        <LeaderboardTop />

        <section class="chip-card leaderboard-page__panel">
            <header class="leaderboard-page__header">
                <div>
                    <p class="chip-eyebrow">Full leaderboard</p>
                    <h1 class="leaderboard-page__title">All contenders</h1>
                    <p class="leaderboard-page__subtitle">
                        The full ranking is updated live. Use the search field to jump to a player when you're logged in.
                    </p>
                </div>
                <div class="leaderboard-page__metric-switch">
                    <button
                        v-for="option in metricOptions"
                        :key="option.id"
                        class="chip-pill leaderboard-top__metric"
                        :class="{ 'leaderboard-top__metric--active': option.id === activeMetric }"
                        type="button"
                        @click="setMetric(option.id)"
                    >
                        <span aria-hidden="true">{{ option.icon }}</span>
                        {{ option.label }}
                    </button>
                </div>
            </header>

            <div class="leaderboard-page__toolbar">
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
                <p v-if="!canSearch" class="leaderboard-page__notice">
                    Log in to unlock search and advanced stats.
                </p>
                <button class="chip-btn chip-btn-ghost" type="button" @click="refresh">
                    Refresh
                </button>
            </div>

            <div class="leaderboard-page__viewer" v-if="viewerRank">
                <span class="chip-pill chip-pill-info">Your rank</span>
                <p>You are currently <strong>#{{ viewerRank.rank }}</strong> on {{ activeMetricLabel }}.</p>
            </div>

            <div class="leaderboard-page__table" role="table">
                <div class="leaderboard-page__table-head" role="row">
                    <span class="leaderboard-page__head-col">Rank</span>
                    <span class="leaderboard-page__head-col">Player</span>
                    <span class="leaderboard-page__head-col">Metric</span>
                    <span class="leaderboard-page__head-col">Trend</span>
                    <span class="leaderboard-page__head-col">Stats</span>
                </div>
                <ul class="leaderboard-page__table-body" role="rowgroup">
                    <li v-if="tableLoading" class="leaderboard-top__empty">
                        <span class="loader" aria-hidden="true"></span>
                        <p>Fetching rankings…</p>
                    </li>
                    <li v-else-if="!entries.length" class="leaderboard-top__empty">
                        <p class="leaderboard-top__empty-title">{{ emptyState.title }}</p>
                        <p class="leaderboard-top__empty-copy">{{ emptyState.description }}</p>
                    </li>
                    <LeaderboardRow
                        v-for="entry in entries"
                        :key="entry.rank"
                        :entry="entry"
                        :show-stats="canSearch"
                    />
                </ul>
            </div>

            <footer class="leaderboard-page__footer">
                <button
                    class="chip-btn chip-btn-ghost"
                    type="button"
                    :disabled="pagination.page === 1"
                    @click="setPage(pagination.page - 1)"
                >
                    Previous
                </button>
                <p>Page {{ pagination.page }} / {{ totalPages }}</p>
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
import { mapGetters } from "vuex"
import LeaderboardTop from "../components/LeaderboardTop.vue"
import LeaderboardRow from "../components/LeaderboardRow.vue"
import useLeaderboard from "../composables/useLeaderboard"

export default {
    name: "LeaderboardPage",
    components: {
        LeaderboardTop,
        LeaderboardRow
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated"]),
        entries() {
            return this.store?.tableItems.value || []
        },
        tableLoading() {
            return this.store?.tableLoading.value || false
        },
        metricOptions() {
            return this.store?.metricOptions.value || []
        },
        activeMetric() {
            return this.store?.metric.value
        },
        activeMetricLabel() {
            const current = this.activeMetric
            const match = this.metricOptions.find((option) => option.id === current)
            return match?.label || "current metric"
        },
        emptyState() {
            return this.store?.tableMeta.value?.emptyState || this.store?.topMeta.value?.emptyState || {
                title: "Leaderboard warming up",
                description: "Once players start competing, rankings will appear here."
            }
        },
        pagination() {
            return this.store?.pagination || { page: 1 }
        },
        totalPages() {
            return this.store?.tableMeta.value?.totalPages || 1
        },
        canSearch() {
            return this.store?.canSearch?.value ?? false
        },
        viewerRank() {
            return this.store?.viewer?.value || null
        },
        searchPlaceholder() {
            return this.canSearch ? "Search by Discord id or name" : "Login required to search"
        }
    },
    data() {
        return {
            store: null,
            searchQuery: ""
        }
    },
    watch: {
        isAuthenticated: {
            immediate: true,
            handler(value) {
                if (this.store?.canSearch) {
                    this.store.canSearch.value = Boolean(value)
                }
            }
        },
        searchQuery(value) {
            if (this.store) {
                this.store.search.value = value
            }
        }
    },
    created() {
        this.store = useLeaderboard({
            canSearch: this.isAuthenticated
        })
    },
    methods: {
        setMetric(metricId) {
            if (this.store) {
                this.store.setMetric(metricId)
            }
        },
        setPage(page) {
            if (this.store) {
                this.store.setPage(page)
            }
        },
        refresh() {
            if (this.store) {
                this.store.refresh()
            }
        }
    }
}
</script>
