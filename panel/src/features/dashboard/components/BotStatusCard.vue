<template>
    <div class="chip-card chip-card--status" :class="cardStateClass">
        <div
            v-if="isUpdating"
            class="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-500/10 via-transparent to-rose-500/15 animate-chip-shimmer"
        ></div>
        <div class="relative z-10 chip-stack">
            <div class="chip-card__header">
                <div class="chip-stack">
                    <div class="flex items-center gap-2">
                        <span class="chip-eyebrow">Runtime posture</span>
                        <span
                            class="chip-info-dot"
                            role="img"
                            tabindex="0"
                            aria-label="Runtime controls info"
                            data-tooltip="Pause or resume the bot and monitor dependencies from here."
                        ></span>
                    </div>
                    <h3 class="chip-card__title">Runtime health</h3>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Track processes, cooldowns, and response posture in real time.
                    </p>
                </div>
            </div>

            <div class="chip-divider chip-divider--strong my-1"></div>
            <div class="flex flex-col gap-3">
                <div class="flex items-center justify-between gap-4">
                    <div class="flex flex-col">
                        <span class="chip-status__label">Bot process</span>
                        <span class="chip-field-hint">Pause or resume runtime responses.</span>
                    </div>
                    <ChipToggle
                        class="w-40"
                        :label="statusLabel"
                        :checked="displayStatusEnabled"
                        :visual-on="displayStatusEnabled"
                        :busy="isUpdating"
                        :disabled="processToggleDisabled"
                        :tone="statusToggleTone"
                        aria-label="Bot process toggle"
                        @toggle="handleProcessToggle"
                    />
                </div>
                <div class="flex items-center justify-between gap-4">
                    <div class="flex flex-col">
                        <span class="chip-status__label">MySQL</span>
                        <span class="chip-field-hint">Database connectivity monitor.</span>
                    </div>
                    <ChipToggle
                        class="w-40"
                        :label="mysqlBadgeLabel"
                        :checked="mysqlStatus"
                        :disabled="true"
                        :tone="mysqlToggleTone"
                        aria-label="MySQL connectivity indicator"
                    />
                </div>
            </div>

            <div class="grid gap-3">
                <div
                    v-for="metric in latencyMetrics"
                    :key="metric.key"
                    class="flex items-center justify-between gap-4"
                >
                    <div class="flex flex-col">
                        <span class="chip-status__label">{{ metric.label }}</span>
                        <span class="chip-field-hint" v-if="metric.hint">{{ metric.hint }}</span>
                    </div>
                    <span v-if="metric.ready" class="chip-status__value" :class="metric.toneClass">
                        {{ metric.display }}
                    </span>
                    <span v-else class="chip-status__skeleton" aria-hidden="true"></span>
                </div>
            </div>

        </div>
    </div>
</template>

<script>
import { formatDetailedDateTime } from "../../../utils/formatters"
import ChipToggle from "./ChipToggle.vue"

export default {
    name: "BotStatusCard",
    components: {
        ChipToggle
    },
    props: {
        status: {
            type: Object,
            default: () => ({})
        },
        loading: {
            type: Boolean,
            default: false
        },
        cooldownActive: {
            type: Boolean,
            default: false
        },
        cooldownTarget: {
            type: String,
            default: null
        },
        cooldownRemaining: {
            type: Number,
            default: 0
        },
        cooldownDuration: {
            type: Number,
            default: 0
        },
        toggleHoldDuration: {
            type: Number,
            default: 3000
        }
    },
    data() {
        return {
            forceUpdating: false,
            updatingTimeout: null,
            optimisticStatus: null
        }
    },
    watch: {
        loading(newVal, oldVal) {
            // When loading flips on, force an "Updating" badge for 5s.
            if (newVal && !oldVal) {
                this.forceUpdating = true
                if (this.updatingTimeout) {
                    clearTimeout(this.updatingTimeout)
                }
                this.updatingTimeout = setTimeout(() => {
                    this.forceUpdating = false
                    this.updatingTimeout = null
                }, 5000)
            }
            if (!newVal && oldVal && this.optimisticStatus !== null) {
                if (!this.statusAvailable || this.status.enabled !== this.optimisticStatus) {
                    this.optimisticStatus = null
                }
            }
        },
        "status.enabled"(value) {
            if (this.optimisticStatus === null) return
            if (typeof value === "boolean" && value === this.optimisticStatus) {
                this.optimisticStatus = null
            }
        }
    },
    beforeDestroy() {
        if (this.updatingTimeout) {
            clearTimeout(this.updatingTimeout)
        }
    },
    computed: {
        statusAvailable() {
            return this.status && typeof this.status.enabled === "boolean"
        },
        displayStatusEnabled() {
            if (this.optimisticStatus !== null) {
                return this.optimisticStatus
            }
            if (this.statusAvailable) {
                return this.status.enabled
            }
            return false
        },
        isUpdating() {
            return this.loading || this.forceUpdating || !this.statusAvailable
        },
        statusLabel() {
            if (!this.statusAvailable && this.optimisticStatus === null) {
                return "Loading…"
            }
            return this.displayStatusEnabled ? "Online" : "Offline"
        },
        cardStateClass() {
            return this.isUpdating ? "ring-1 ring-amber-400/30" : ""
        },
        mysqlStatus() {
            const health = this.status && this.status.health
            const mysql = health && health.mysql
            return Boolean(mysql && mysql.alive)
        },
        formattedUpdatedAt() {
            if (!this.statusAvailable) return null
            return formatDetailedDateTime(this.status.updatedAt)
        },
        metricsReady() {
            return this.statusAvailable
        },
        latencyMetrics() {
            const ready = this.metricsReady
            const latencyValue = ready && typeof this.status.latency === "number"
                ? Math.round(this.status.latency)
                : null
            return [
                {
                    key: "latency",
                    label: "Gateway latency",
                    hint: "Discord websocket round-trip.",
                    display: ready ? (latencyValue !== null ? `${latencyValue} ms` : "N/A") : null,
                    toneClass: latencyValue !== null && latencyValue > 250 ? "chip-status__value--warn" : "chip-status__value--ok",
                    ready
                },
                {
                    key: "updated",
                    label: "Last update",
                    hint: "Timestamp for the latest status poll.",
                    display: ready ? this.formattedUpdatedAt : null,
                    toneClass: "",
                    ready
                }
            ]
        },
        mysqlBadgeLabel() {
            if (!this.metricsReady) return "Loading…"
            return this.mysqlStatus ? "Online" : "Offline"
        },
        statusToggleTone() {
            if (this.isUpdating) return "warn"
            return this.displayStatusEnabled ? "ok" : "danger"
        },
        mysqlToggleTone() {
            if (!this.metricsReady) return ""
            return this.mysqlStatus ? "ok" : "danger"
        },
        processToggleDisabled() {
            if (this.loading || !this.statusAvailable) return true
            return this.cooldownActive
        }
    },
    methods: {
        handleProcessToggle(nextState) {
            if (this.processToggleDisabled) return
            const targetState =
                typeof nextState === "boolean" ? nextState : !this.displayStatusEnabled
            this.optimisticStatus = targetState
            this.$emit("toggle", targetState)
        }
    }
}
</script>
