<template>
    <li class="leaderboard-row" :class="rowClassObject" :style="rowToneStyle">
        <div class="leaderboard-row__rank">
            <span class="leaderboard-row__label">Rank</span>
            <span class="leaderboard-row__rank-pill">#{{ entry.rank }}</span>
        </div>
        <div class="leaderboard-row__player">
            <img :src="entry.avatar" :alt="entry.displayName" class="leaderboard-row__avatar" />
            <div class="leaderboard-row__identity">
                <div class="leaderboard-row__identity-line">
                    <p class="leaderboard-row__name">{{ entry.displayName }}</p>
                    <span v-if="stackDisplay" class="leaderboard-row__stack">
                        {{ stackDisplay }}
                    </span>
                </div>
                <p v-if="momentumLabel" class="leaderboard-row__meta">{{ momentumLabel }}</p>
            </div>
        </div>
        <div class="leaderboard-row__metric-block">
            <span class="leaderboard-row__label">Metric</span>
            <span class="leaderboard-row__metric">{{ formatMetric(entry.metricValue) }}</span>
        </div>
        <div class="leaderboard-row__momentum">
            <span class="leaderboard-row__label">Momentum</span>
            <div class="leaderboard-row__trend-chip" :title="trendLabel">
                <span>{{ trendIndicator }}</span>
                <span>{{ trendLabel }}</span>
            </div>
        </div>
        <div class="leaderboard-row__stats">
            <span class="leaderboard-row__label">Snapshot</span>
            <ul class="leaderboard-row__stats-list">
                <li v-for="stat in statsSummary" :key="stat.key">
                    {{ stat.value }} {{ stat.label }}
                </li>
            </ul>
        </div>
        <span
            v-if="highlightLabel"
            class="leaderboard-row__status"
            :class="highlightToneClass"
            :aria-label="highlightDescription"
        >
            {{ highlightLabel }}
        </span>
    </li>
</template>

<script>
import { defineComponent, computed } from "vue"
import { formatCurrency, formatPercentage } from "../utils/formatters"
import { getPodiumFinish, defaultRingColor } from "../constants/podiumStyles"

const PODIUM_LIMIT = 3
const DEFAULT_ROW_TONE = Object.freeze({
    fill: "transparent",
    border: "transparent",
    containerBorder: "rgba(255, 255, 255, 0.12)"
})

const clampAlpha = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
        return 1
    }
    return Math.min(1, Math.max(0, numeric))
}

const parseHexColor = (color) => {
    if (typeof color !== "string") {
        return null
    }
    const normalized = color.trim()
    const match = normalized.match(/^#?([0-9a-f]{6})$/i)
    if (!match) {
        return null
    }
    const value = match[1]
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    }
}

const toAlphaColor = (color, alpha = 1) => {
    if (typeof color !== "string" || !color.trim()) {
        return null
    }
    const normalized = color.trim()
    if (/^rgba?/i.test(normalized)) {
        return normalized
    }
    const rgb = parseHexColor(normalized)
    if (!rgb) {
        return null
    }
    const safeAlpha = clampAlpha(alpha)
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${safeAlpha})`
}

const buildPodiumTone = (rank, badge = {}) => {
    const finish = getPodiumFinish(rank) || {}
    const ring = typeof badge.ring === "string" ? badge.ring : finish.ring
    const accent = typeof badge.accent === "string" ? badge.accent : finish.accent
    const resolvedRing = ring || defaultRingColor
    const resolvedAccent = accent || resolvedRing
    return {
        fill: toAlphaColor(resolvedAccent, 0.2) || DEFAULT_ROW_TONE.fill,
        border: resolvedRing || DEFAULT_ROW_TONE.border,
        containerBorder: toAlphaColor(resolvedRing, 0.45) || DEFAULT_ROW_TONE.containerBorder
    }
}

export default defineComponent({
    name: "LeaderboardRow",
    props: {
        entry: {
            type: Object,
            required: true
        },
        showStats: {
            type: Boolean,
            default: false
        }
    },
    setup(props) {
        const momentumLabel = computed(() => {
            if (!props.entry?.momentum?.signature) return ""
            return `Momentum ${props.entry.momentum.signature}`
        })

        const trendLabel = computed(() => {
            const direction = props.entry?.trend?.direction
            if (direction === "up") return "Momentum rising"
            if (direction === "down") return "Momentum cooling"
            return "Momentum steady"
        })

        const highlightLabel = computed(() => {
            if (props.entry?.highlight?.isActive) return "Active"
            if (props.entry?.highlight?.isDormant) return "Dormant"
            return ""
        })

        const highlightToneClass = computed(() => {
            if (props.entry?.highlight?.isActive) return "chip-pill-success"
            if (props.entry?.highlight?.isDormant) return "chip-pill-warning"
            return "chip-pill-info"
        })

        const highlightDescription = computed(() => {
            if (props.entry?.highlight?.isActive) return "Active player: tracked within the last week."
            if (props.entry?.highlight?.isDormant) return "Dormant player: waiting for a new round."
            return "Player status indicator."
        })

        const formatMetric = (metricValue = {}) => {
            if (metricValue.type === "percentage") {
                return formatPercentage(metricValue.raw ?? 0)
            }
            return formatCurrency(metricValue.raw ?? 0)
        }

        const stackDisplay = computed(() => {
            const chips = props.entry?.stats?.chips
            if (chips === undefined || chips === null) return ""
            return formatCurrency(chips)
        })

        const statsSummary = computed(() => {
            const stats = props.entry?.stats || {}
            const rows = [
                { key: "net", label: "net", value: formatCurrency(stats.netProfit), show: true },
                { key: "stack", label: "stack", value: formatCurrency(stats.chips), show: true },
                {
                    key: "wr",
                    label: "WR",
                    value: formatPercentage(stats.winRate),
                    show: props.showStats && stats.winRate !== undefined && stats.winRate !== null
                },
                {
                    key: "hands",
                    label: "hands",
                    value: typeof stats.handsPlayed === "number" ? stats.handsPlayed.toLocaleString() : stats.handsPlayed,
                    show: props.showStats && stats.handsPlayed !== undefined && stats.handsPlayed !== null
                }
            ]
            return rows.filter((row) => row.show && row.value !== undefined && row.value !== null && row.value !== "")
        })

        const trendIndicator = computed(() => props.entry?.trend?.indicator || "•")

        const podiumRank = computed(() => {
            const rank = Number(props.entry?.rank)
            if (!Number.isFinite(rank) || rank < 1 || rank > PODIUM_LIMIT) {
                return null
            }
            return rank
        })

        const podiumTone = computed(() => {
            if (!podiumRank.value) {
                return null
            }
            return buildPodiumTone(podiumRank.value, props.entry?.badge)
        })

        const rowToneStyle = computed(() => {
            if (!podiumTone.value) {
                return {}
            }
            return {
                "--leaderboard-row-fill": podiumTone.value.fill,
                "--leaderboard-row-border": podiumTone.value.border,
                "--leaderboard-row-container-border": podiumTone.value.containerBorder,
                backgroundColor: "var(--leaderboard-row-fill)"
            }
        })

        const rowClassObject = computed(() => {
            const classes = {
                "leaderboard-row--viewer": Boolean(props.entry?.isViewer)
            }
            if (podiumTone.value) {
                classes["leaderboard-row--podium"] = true
                classes[`leaderboard-row--podium-${podiumRank.value}`] = true
            }
            return classes
        })

        return {
            formatMetric,
            formatCurrency,
            formatPercentage,
            momentumLabel,
            trendLabel,
            highlightLabel,
            highlightToneClass,
            highlightDescription,
            stackDisplay,
            statsSummary,
            trendIndicator,
            rowToneStyle,
            rowClassObject
        }
    }
})
</script>
