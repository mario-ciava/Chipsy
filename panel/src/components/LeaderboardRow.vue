<template>
    <li class="leaderboard-row" :class="{ 'leaderboard-row--viewer': entry.isViewer }">
        <div class="leaderboard-row__rank">{{ entry.rank }}</div>
        <img :src="entry.avatar" :alt="entry.displayName" class="leaderboard-row__avatar" />
        <div class="leaderboard-row__player">
            <p class="leaderboard-row__name">{{ entry.displayName }}</p>
            <p class="leaderboard-row__meta">{{ momentumLabel }}</p>
        </div>
        <div class="leaderboard-row__metric">{{ formatMetric(entry.metricValue) }}</div>
        <div class="leaderboard-row__trend" :title="trendLabel">
            {{ entry.trend.indicator }}
        </div>
        <div class="leaderboard-row__stats">
            <span>{{ formatCurrency(entry.stats?.netProfit) }} net</span>
            <span>{{ formatCurrency(entry.stats?.chips) }} stack</span>
            <span v-if="showStats && entry.stats?.winRate !== undefined">
                {{ formatPercentage(entry.stats.winRate) }} WR
            </span>
            <span v-if="showStats && entry.stats?.handsPlayed !== undefined">
                {{ entry.stats.handsPlayed }} hands
            </span>
        </div>
        <span v-if="entry.highlight?.badge" class="chip-pill leaderboard-row__status" :style="getHighlightStyle()">
            {{ highlightLabel }}
        </span>
    </li>
</template>

<script>
import { defineComponent, computed } from "vue"
import { formatCurrency, formatPercentage } from "../utils/formatters"

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
            if (direction === "up") return "Trending up"
            if (direction === "down") return "Trending down"
            return "Holding position"
        })

        const highlightLabel = computed(() => {
            if (props.entry?.highlight?.isActive) return "Active"
            if (props.entry?.highlight?.isDormant) return "Dormant"
            return ""
        })

        const getHighlightStyle = () => {
            const palette = props.entry?.highlight?.badge
            if (!palette) return {}
            return {
                background: palette.background,
                color: palette.color,
                borderColor: palette.background
            }
        }

        const formatMetric = (metricValue = {}) => {
            if (metricValue.type === "percentage") {
                return formatPercentage(metricValue.raw ?? 0)
            }
            return formatCurrency(metricValue.raw ?? 0)
        }

        return {
            formatMetric,
            formatCurrency,
            formatPercentage,
            momentumLabel,
            trendLabel,
            highlightLabel,
            getHighlightStyle
        }
    }
})
</script>
