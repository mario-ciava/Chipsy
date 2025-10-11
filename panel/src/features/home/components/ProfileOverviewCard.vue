<template>
    <article class="chip-card chip-stack relative overflow-hidden">
        <header class="chip-card__header flex-col gap-4 lg:flex-row lg:flex-nowrap lg:items-start">
            <div class="chip-stack">
                <div class="flex items-center gap-2">
                    <span class="chip-eyebrow">Player identity</span>
                    <span
                        class="chip-info-dot"
                        role="img"
                        tabindex="0"
                        aria-label="Profile insight"
                        :data-tooltip="tooltipCopy"
                    ></span>
                </div>
                <h3 class="chip-card__title">Your Chipsy profile</h3>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Review bankroll, gold, and cooldown timers without switching contexts.
                </p>
            </div>
            <div class="ml-auto flex min-w-[14rem] flex-col items-end gap-1">
                <div class="flex items-center gap-2">
                    <div class="chip-identity chip-identity--combo">
                        <div class="chip-identity__avatar">
                            <img
                                v-if="avatarUrl"
                                :src="avatarUrl"
                                :alt="`${displayHandle} avatar`"
                                class="chip-identity__avatar-img"
                            />
                            <span v-else class="chip-identity__avatar-placeholder">
                                {{ handleInitial }}
                            </span>
                        </div>
                        <span class="chip-identity__handle">{{ displayHandle }}</span>
                    </div>
                    <button
                        class="chip-identity__cta"
                        type="button"
                        :disabled="refreshing"
                        aria-label="Refresh profile"
                        @click="$emit('refresh')"
                    >
                        <span v-if="refreshing" class="chip-spinner"></span>
                        <span v-else aria-hidden="true">↻</span>
                    </button>
                </div>
                <span class="chip-field-hint w-full text-center lg:max-w-[14rem]">
                    {{ hasProfile ? "Live synced" : "Waiting for your first hand" }}
                </span>
            </div>
        </header>

        <div class="chip-divider chip-divider--strong my-1.5"></div>

        <div v-if="metricsReady">
            <div
                ref="metricScroll"
                class="chip-stack gap-3 max-h-[320px] chip-status-scroll pr-1"
                @scroll="handleScroll"
            >
                <div
                    v-for="metric in metrics"
                    :key="metric.key"
                    class="chip-status__row border-b border-white/5 pb-3"
                >
                    <div class="flex flex-col">
                    <span
                        class="chip-status__label"
                        :class="metric.toneClass"
                    >
                        {{ metric.label }}
                    </span>
                        <span v-if="metric.hint" class="chip-field-hint">{{ metric.hint }}</span>
                    </div>
                    <span class="chip-status__value" :class="metric.toneClass || ''">
                        {{ metric.display }}
                    </span>
                </div>
                <div class="chip-status__row border-b border-white/5 pb-3">
                    <div class="flex flex-col">
                        <span class="chip-status__label">Next reward</span>
                        <span class="chip-field-hint">Auto payout cadence</span>
                    </div>
                    <span class="chip-status__value">{{ nextRewardCopy }}</span>
                </div>
                <template v-if="hasExtraMetrics">
                    <div class="chip-stack gap-3">
                        <div
                            v-for="(row, rowIndex) in extraMetricRows"
                            :key="`extra-row-${rowIndex}`"
                            class="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-x-8"
                            :class="rowIndex === extraMetricRows.length - 1 ? '' : 'border-b border-white/5 pb-3'"
                        >
                            <div
                                v-for="metric in row"
                                :key="metric.key"
                                class="chip-status__row"
                            >
                                <div class="flex flex-col">
                                    <span class="chip-status__label">{{ metric.label }}</span>
                                    <span v-if="metric.hint" class="chip-field-hint">{{ metric.hint }}</span>
                                </div>
                                <span class="chip-status__value" :class="metric.toneClass || ''">
                                    {{ metric.display }}
                                </span>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
        <p v-else class="chip-empty">
            {{ fallbackEmptyCopy }}
        </p>
        <div v-if="metricsReady && showScrollHint" class="chip-scroll-hint" aria-hidden="true">
            <span class="chip-scroll-dot chip-scroll-dot--delay-0"></span>
            <span class="chip-scroll-dot chip-scroll-dot--delay-1"></span>
            <span class="chip-scroll-dot chip-scroll-dot--delay-2"></span>
        </div>
    </article>
</template>

<script>
export default {
    name: "ProfileOverviewCard",
    props: {
        username: {
            type: String,
            default: ""
        },
        metrics: {
            type: Array,
            default: () => []
        },
        extraMetrics: {
            type: Array,
            default: () => []
        },
        avatarUrl: {
            type: String,
            default: ""
        },
        refreshing: {
            type: Boolean,
            default: false
        },
        emptyCopy: {
            type: String,
            default: "We could not find Chipsy stats for this account yet. Play a game to create the profile."
        },
        hasProfile: {
            type: Boolean,
            default: false
        },
        nextReward: {
            type: String,
            default: ""
        }
    },
    emits: ["refresh"],
    data() {
        return {
            scrollAtEnd: false
        }
    },
    computed: {
        displayHandle() {
            return this.username ? `@${this.username}` : "@unknown"
        },
        handleInitial() {
            const cleaned = this.displayHandle.replace(/^@/, "")
            return cleaned.charAt(0).toUpperCase() || "?"
        },
        metricsReady() {
            return this.hasProfile && this.metrics.length > 0
        },
        fallbackEmptyCopy() {
            return this.emptyCopy
        },
        tooltipCopy() {
            return "Keep tabs on bankroll, progression, and runtime timestamps without leaving the panel."
        },
        nextRewardCopy() {
            return this.nextReward || "Available"
        },
        showScrollHint() {
            return this.hasExtraMetrics && !this.scrollAtEnd
        },
        hasExtraMetrics() {
            return Array.isArray(this.extraMetrics) && this.extraMetrics.length > 0
        },
        extraMetricRows() {
            if (!this.hasExtraMetrics) return []
            const rows = []
            for (let i = 0; i < this.extraMetrics.length; i += 2) {
                rows.push(this.extraMetrics.slice(i, i + 2))
            }
            return rows
        }
    },
    watch: {
        extraMetrics: {
            deep: true,
            handler() {
                this.resetScrollHint()
            }
        },
        metricsReady(newValue) {
            if (newValue) {
                this.resetScrollHint()
            }
        }
    },
    mounted() {
        this.resetScrollHint()
    },
    methods: {
        handleScroll(event) {
            const target = event?.target || this.$refs.metricScroll
            if (!target) return
            const reachedEnd = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
            const noOverflow = target.scrollHeight <= target.clientHeight + 1
            this.scrollAtEnd = reachedEnd || noOverflow
        },
        resetScrollHint() {
            this.scrollAtEnd = false
            this.$nextTick(() => {
                const target = this.$refs.metricScroll
                if (!target) return
                this.handleScroll({ target })
            })
        }
    }
}
</script>
