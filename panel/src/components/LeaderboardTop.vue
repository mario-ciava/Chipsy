<template>
    <section class="chip-card chip-leaderboard" aria-labelledby="leaderboardTopHeading">
        <header class="chip-card__header leaderboard-top__header">
            <div class="leaderboard-top__heading">
                <p class="chip-eyebrow">🏆 Global leaderboard</p>
                <h2 id="leaderboardTopHeading" class="chip-card__title">Global Champions</h2>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Track Chipsy's top performers and switch metrics to watch the podium shift.
                </p>
            </div>
            <div class="leaderboard-top__metric-column" role="group" aria-label="Leaderboard metric selector">
                <div class="leaderboard-top__metric-segments">
                    <button
                        v-for="option in displayMetricOptions"
                        :key="option.id"
                        class="leaderboard-top__metric-option"
                        :class="{ 'leaderboard-top__metric-option--active': option.id === activeMetric }"
                        type="button"
                        @click="setMetric(option.id)"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
        </header>

        <div class="chip-divider chip-divider--strong my-1.5"></div>

        <div v-if="topLoading" class="leaderboard-top__empty">
            <span class="loader" aria-hidden="true"></span>
            <p>Loading leaderboard…</p>
        </div>
        <div v-else-if="topError" class="leaderboard-top__empty">
            <p class="leaderboard-top__empty-title">Unable to load the leaderboard</p>
            <p class="leaderboard-top__empty-copy">{{ topError }}</p>
        </div>
        <div v-else-if="!podiumEntries.length" class="leaderboard-top__empty">
            <p class="leaderboard-top__empty-title">{{ emptyState.title }}</p>
            <p class="leaderboard-top__empty-copy">{{ emptyState.description }}</p>
        </div>
        <div v-else class="leaderboard-top__body">
            <div class="leaderboard-top__podium">
                <article
                    v-for="(entry, index) in podiumEntries"
                    :key="entry.rank"
                    class="leaderboard-top__podium-card"
                    :class="{
                        'leaderboard-top__podium-card--viewer': entry.isViewer,
                        'leaderboard-top__podium-card--first': entry.rank === 1,
                        'leaderboard-top__podium-card--second': entry.rank === 2,
                        'leaderboard-top__podium-card--third': entry.rank === 3
                    }"
                    :style="getPodiumStyle(entry, index)"
                >
                    <div class="leaderboard-top__podium-rank-panel">
                        <span class="leaderboard-top__podium-rank">{{ entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉' }}</span>
                    </div>
                    <div class="leaderboard-top__podium-track">
                        <div class="leaderboard-top__podium-body">
                            <div class="leaderboard-top__podium-profile">
                                <img
                                    :src="entry.avatar"
                                    :alt="entry.displayName"
                                    class="leaderboard-top__podium-avatar"
                                />
                                <div class="leaderboard-top__podium-meta">
                                    <div class="leaderboard-top__podium-ident">
                                        <p class="leaderboard-top__podium-name">{{ entry.displayName }}</p>
                                        <span
                                            v-if="entry.highlight?.isActive || entry.highlight?.isDormant"
                                            class="leaderboard-top__status"
                                            :class="getHighlightToneClass(entry)"
                                            :aria-label="getHighlightDescription(entry)"
                                        >
                                            {{ entry.highlight?.isActive ? "Online" : "Dormant" }}
                                        </span>
                                    </div>
                                    <p v-if="entry.momentum?.signature" class="leaderboard-top__podium-momentum">
                                        {{ formatMomentum(entry.momentum) }}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div class="leaderboard-top__podium-score">
                            <p class="leaderboard-top__podium-detail">
                                {{ activeMetricLabel }}
                            </p>
                            <p class="leaderboard-top__podium-value">{{ formatMetric(entry.metricValue) }}</p>
                        </div>
                    </div>
                </article>
            </div>
            <div class="chip-divider chip-divider--strong my-1.5 leaderboard-top__divider"></div>
            <ul class="leaderboard-top__list">
                <li
                    v-for="(entry, index) in challengerEntries"
                    :key="entry.rank"
                    class="leaderboard-top__list-row leaderboard-top__list-row--scaled"
                    :class="{
                        'leaderboard-top__list-row--viewer': entry.isViewer,
                        'leaderboard-top__list-row--divider': index === 0
                    }"
                >
                    <div class="leaderboard-top__list-rank-panel">
                        <span class="leaderboard-top__list-rank-pill">#{{ entry.rank }}</span>
                    </div>
                    <div class="leaderboard-top__list-profile">
                        <img :src="entry.avatar" :alt="entry.displayName" class="leaderboard-top__list-avatar" />
                        <div class="leaderboard-top__list-player">
                            <p class="leaderboard-top__list-name">{{ entry.displayName }}</p>
                            <p v-if="entry.momentum?.signature" class="leaderboard-top__list-meta">
                                {{ formatMomentum(entry.momentum) }}
                            </p>
                        </div>
                    </div>
                    <div class="leaderboard-top__list-score">
                        <p class="leaderboard-top__list-metric-label">{{ activeMetricLabel }}</p>
                        <p class="leaderboard-top__list-value">{{ formatMetric(entry.metricValue) }}</p>
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
import {
    defaultRingColor,
    defaultAccentOverlay,
    defaultCardGradient,
    defaultScoreGradient,
    defaultScoreTexture,
    getPodiumFinish
} from "../constants/podiumStyles"

const hexToRgb = (value = "") => {
    const input = value.replace("#", "")
    if (![3, 6].includes(input.length)) return null
    const normalized = input.length === 3
        ? input.split("").map((char) => char + char).join("")
        : input
    const numeric = Number.parseInt(normalized, 16)
    if (Number.isNaN(numeric)) return null
    return {
        r: (numeric >> 16) & 255,
        g: (numeric >> 8) & 255,
        b: numeric & 255
    }
}

const toOverlay = (value, alpha = 0.22) => {
    if (!value) return defaultAccentOverlay
    const color = String(value).trim()
    if (color.startsWith("#")) {
        const rgb = hexToRgb(color)
        if (!rgb) return defaultAccentOverlay
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
    }
    if (color.startsWith("rgba")) {
        const channels = color
            .replace(/rgba\(/i, "")
            .replace(/\)/, "")
            .split(",")
            .map((chunk) => chunk.trim())
            .slice(0, 3)
        if (channels.length < 3) return defaultAccentOverlay
        return `rgba(${channels.join(", ")}, ${alpha})`
    }
    if (color.startsWith("rgb")) {
        const channels = color
            .replace(/rgb\(/i, "")
            .replace(/\)/, "")
            .split(",")
            .map((chunk) => chunk.trim())
        if (channels.length < 3) return defaultAccentOverlay
        return `rgba(${channels.join(", ")}, ${alpha})`
    }
    return defaultAccentOverlay
}

export default defineComponent({
    name: "LeaderboardTop",
    setup() {
        const leaderboard = useLeaderboard({ withTable: false })

        const entries = computed(() => leaderboard.topItems.value || [])
        const podiumEntries = computed(() => entries.value.slice(0, 3))
        const challengerEntries = computed(() => entries.value.slice(3, 10))
        const topMeta = computed(() => leaderboard.topMeta.value || {})

        const emptyState = computed(() => topMeta.value?.emptyState || {
            title: "Leaderboard warming up",
            description: "Once players start competing, rankings will appear here."
        })

        const metricOptions = computed(() => leaderboard.metricOptions.value || [])
        const activeMetric = computed(() => leaderboard.metric.value)

        const topLoading = computed(() => leaderboard.topLoading.value)
        const topError = computed(() => leaderboard.topError.value)

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
            if (direction === "up") return "Momentum rising"
            if (direction === "down") return "Momentum cooling"
            return "Momentum steady"
        }

        const formatMomentum = (momentum) => momentum?.signature || ""

        const getTrendIndicator = (entry) => {
            const indicator = entry?.trend?.indicator || ""
            return indicator === "📈" ? "" : indicator
        }

        const getPodiumStyle = (entry, index = 0) => {
            const finish = getPodiumFinish(index + 1) || getPodiumFinish(Number(entry.rank)) || null
            const badge = entry.badge || {}
            const ring = badge.ring || finish?.ring || defaultRingColor
            const accent = badge.accent || finish?.accent || ring
            const cardGradient = badge.cardGradient || finish?.cardGradient || defaultCardGradient
            const scoreGradient = badge.scoreGradient || badge.gradient || finish?.gradient || defaultScoreGradient
            const scoreTexture = badge.scoreTexture || badge.texture || finish?.texture || defaultScoreTexture
            const scoreBorder = badge.scoreBorder || finish?.scoreBorder || "rgba(255, 255, 255, 0.08)"
            const rankGradient = badge.rankGradient || finish?.rankGradient || null
            return {
                "--podium-ring-color": ring,
                "--podium-accent-overlay": toOverlay(accent, 0.22),
                "--podium-rank-fill": toOverlay(accent, 0.4),
                "--podium-card-gradient": cardGradient,
                "--podium-score-gradient": scoreGradient,
                "--podium-score-texture": scoreTexture,
                "--podium-score-border": scoreBorder,
                "--podium-rank-gradient": rankGradient
            }
        }

        const getHighlightToneClass = (entry) => {
            if (entry?.highlight?.isActive) return "chip-role-online"
            if (entry?.highlight?.isDormant) return "chip-role-dormant"
            return "chip-role-badge"
        }

        const getHighlightDescription = (entry) => {
            if (entry?.highlight?.isActive) {
                return "Active player: logged games recently."
            }
            if (entry?.highlight?.isDormant) {
                return "Dormant player: waiting for a new session."
            }
            return "Player status indicator."
        }

        const metricCopyMap = {
            "net-profit": {
                label: "Net winnings"
            },
            chips: {
                label: "Current chips"
            },
            "win-rate": {
                label: "Winrate"
            }
        }
        const displayMetricOptions = computed(() => metricOptions.value.map((option) => {
            const overrides = metricCopyMap[option.id] || {}
            return {
                ...option,
                label: overrides.label || option.label
            }
        }))
        const activeMetricLabel = computed(() => {
            const current = displayMetricOptions.value.find((option) => option.id === activeMetric.value)
            return current?.label || ""
        })

        return {
            metricOptions,
            displayMetricOptions,
            activeMetric,
            activeMetricLabel,
            podiumEntries,
            challengerEntries,
            topLoading,
            emptyState,
            formatMetric,
            formatTrend,
            formatMomentum,
            getPodiumStyle,
            getHighlightToneClass,
            getHighlightDescription,
            getTrendIndicator,
            setMetric,
            topError
        }
    }
})
</script>
