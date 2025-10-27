<template>
    <section class="chip-card chip-leaderboard">
        <header class="leaderboard-top__header">
            <div>
                <p class="chip-eyebrow">🏆 Global leaderboard</p>
                <h2 class="leaderboard-top__title">Global Champions</h2>
                <p class="leaderboard-top__subtitle">
                    Track the players who keep Chipsy buzzing. Switch the metric to watch the podium reshuffle in real time.
                </p>
            </div>
            <div class="leaderboard-top__actions">
                <div class="leaderboard-top__metric-switch">
                    <button
                        v-for="option in metricOptions"
                        :key="option.id"
                        class="chip-pill leaderboard-top__metric"
                        :class="{ 'leaderboard-top__metric--active': option.id === activeMetric }"
                        type="button"
                        @click="setMetric(option.id)"
                    >
                        <span class="leaderboard-top__metric-icon" aria-hidden="true">{{ option.icon }}</span>
                        {{ option.label }}
                    </button>
                </div>
                <router-link
                    v-if="ctaLink"
                    :to="ctaLink"
                    class="chip-btn chip-btn-secondary"
                >
                    {{ ctaLabel }}
                </router-link>
            </div>
        </header>

        <div v-if="topLoading" class="leaderboard-top__empty">
            <span class="loader" aria-hidden="true"></span>
            <p>Loading leaderboard…</p>
        </div>
        <div v-else-if="!podiumEntries.length" class="leaderboard-top__empty">
            <p class="leaderboard-top__empty-title">{{ emptyState.title }}</p>
            <p class="leaderboard-top__empty-copy">{{ emptyState.description }}</p>
        </div>
        <div v-else class="leaderboard-top__body">
            <div class="leaderboard-top__podium">
                <article
                    v-for="entry in podiumEntries"
                    :key="entry.rank"
                    class="leaderboard-top__podium-card"
                    :class="{ 'leaderboard-top__podium-card--viewer': entry.isViewer }"
                    :style="getPodiumStyle(entry)"
                >
                    <div class="leaderboard-top__podium-rank">{{ entry.rank }}°</div>
                    <img
                        :src="entry.avatar"
                        :alt="entry.displayName"
                        class="leaderboard-top__podium-avatar"
                    />
                    <div class="leaderboard-top__podium-meta">
                        <p class="leaderboard-top__podium-name">{{ entry.displayName }}</p>
                        <p class="leaderboard-top__podium-value">{{ formatMetric(entry.metricValue) }}</p>
                        <p class="leaderboard-top__podium-detail">
                            {{ formatTrend(entry) }} • {{ formatMomentum(entry.momentum) }}
                        </p>
                    </div>
                    <span v-if="entry.highlight.isActive" class="chip-pill leaderboard-top__status" :style="getHighlightStyle(entry)">
                        Active now
                    </span>
                    <span v-else-if="entry.highlight.isDormant" class="chip-pill leaderboard-top__status" :style="getHighlightStyle(entry)">
                        Dormant
                    </span>
                </article>
            </div>
            <ul class="leaderboard-top__list">
                <li
                    v-for="entry in challengerEntries"
                    :key="entry.rank"
                    class="leaderboard-top__list-row"
                    :class="{ 'leaderboard-top__list-row--viewer': entry.isViewer }"
                >
                    <div class="leaderboard-top__list-rank">{{ entry.rank }}</div>
                    <img :src="entry.avatar" :alt="entry.displayName" class="leaderboard-top__list-avatar" />
                    <div class="leaderboard-top__list-player">
                        <p class="leaderboard-top__list-name">{{ entry.displayName }}</p>
                        <p class="leaderboard-top__list-meta">
                            {{ formatMomentum(entry.momentum) }}
                        </p>
                    </div>
                    <div class="leaderboard-top__list-value">{{ formatMetric(entry.metricValue) }}</div>
                    <div class="leaderboard-top__list-trend" :title="formatTrend(entry)">
                        {{ entry.trend.indicator }}
                    </div>
                </li>
            </ul>
        </div>
    </section>
</template>

<script>
import { defineComponent, computed } from "vue"
import useLeaderboard from "../composables/useLeaderboard"
import { formatCurrency, formatPercentage } from "../utils/formatters"

export default defineComponent({
    name: "LeaderboardTop",
    setup() {
        const leaderboard = useLeaderboard({ withTable: false })

        const entries = computed(() => leaderboard.topItems.value || [])
        const podiumEntries = computed(() => entries.value.slice(0, 3))
        const challengerEntries = computed(() => entries.value.slice(3, 10))
        const topMeta = computed(() => leaderboard.topMeta.value || {})

        const ctaLink = computed(() => topMeta.value?.links?.full || "/leaderboard")
        const ctaLabel = computed(() => topMeta.value?.cta?.label || "View full leaderboard")
        const emptyState = computed(() => topMeta.value?.emptyState || {
            title: "Leaderboard warming up",
            description: "Once players start competing, rankings will appear here."
        })

        const metricOptions = computed(() => leaderboard.metricOptions.value || [])
        const activeMetric = computed(() => leaderboard.metric.value)

        const topLoading = computed(() => leaderboard.topLoading.value)

        const setMetric = (metricId) => {
            if (metricId && metricId !== leaderboard.metric.value) {
                leaderboard.setMetric(metricId)
            }
        }

        const formatMetric = (metricValue = {}) => {
            if (metricValue.type === "percentage") {
                return formatPercentage(metricValue.raw ?? 0)
            }
            return formatCurrency(metricValue.raw ?? 0)
        }

        const formatTrend = (entry) => {
            const direction = entry.trend?.direction || "steady"
            if (direction === "up") return "Trending up"
            if (direction === "down") return "Trending down"
            return "Holding position"
        }

        const formatMomentum = (momentum) => {
            if (!momentum?.signature) return ""
            return `Momentum ${momentum.signature}`
        }

        const getPodiumStyle = (entry) => {
            if (!entry.badge) return {}
            return {
                borderColor: entry.badge.ring,
                background: entry.badge.accent
            }
        }

        const getHighlightStyle = (entry) => {
            if (!entry.highlight?.badge) return {}
            return {
                background: entry.highlight.badge.background,
                color: entry.highlight.badge.color,
                borderColor: entry.highlight.badge.background
            }
        }

        return {
            metricOptions,
            activeMetric,
            podiumEntries,
            challengerEntries,
            topLoading,
            emptyState,
            ctaLink,
            ctaLabel,
            formatMetric,
            formatTrend,
            formatMomentum,
            getPodiumStyle,
            getHighlightStyle,
            setMetric
        }
    }
})
</script>
