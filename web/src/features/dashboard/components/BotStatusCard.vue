<template>
    <div class="chip-card overflow-hidden" :class="cardStateClass">
        <div
            v-if="isUpdating"
            class="pointer-events-none absolute inset-0 bg-gradient-to-r from-amber-500/10 via-transparent to-rose-500/15 animate-chip-shimmer"
        ></div>
        <div class="relative z-10 space-y-6">
            <div class="chip-card__header">
                <div>
                    <h3 class="chip-card__title">Bot status</h3>
                    <p class="chip-card__subtitle">
                        Check bot availability and the health of its dependencies.
                    </p>
                </div>
                <div>
                    <transition name="status-flip" mode="out-in">
                        <span
                            :key="statusKey"
                            class="chip-pill"
                            :class="statusPillClass"
                        >
                            {{ statusLabel }}
                        </span>
                    </transition>
                </div>
            </div>

            <ul class="grid gap-4 sm:grid-cols-3">
                <li
                    v-for="metric in statusMetrics"
                    :key="metric.key"
                    class="rounded-2xl border border-white/5 bg-white/5 px-4 py-3"
                >
                    <p class="chip-label text-[0.7rem]">{{ metric.label }}</p>
                    <p
                        v-if="metric.ready"
                        :class="['mt-2 text-lg font-semibold text-white', metric.toneClass]"
                    >
                        {{ metric.display }}
                    </p>
                    <span
                        v-else
                        class="mt-2 block h-4 w-20 animate-pulse rounded-full bg-white/10"
                        aria-hidden="true"
                    ></span>
                </li>
            </ul>

            <div class="flex flex-col gap-4">
                <div class="flex flex-wrap gap-3">
                    <button
                        type="button"
                        class="chip-btn chip-btn-secondary chip-btn-fixed relative overflow-hidden"
                        :disabled="disableDisableButton"
                        @pointerdown="onHoldStart('disable', $event)"
                        @pointerup="onHoldCancel"
                        @pointerleave="onHoldCancel"
                        @pointercancel="onHoldCancel"
                        @keydown.space.prevent="onKeyHoldStart('disable', $event)"
                        @keyup.space="onHoldCancel"
                        @keydown.enter.prevent="onKeyHoldStart('disable', $event)"
                        @keyup.enter="onHoldCancel"
                        @blur="onHoldCancel"
                        @contextmenu.prevent
                    >
                        <span
                            class="chip-btn-progress"
                            :class="{ 'opacity-100': isHoldTarget('disable') }"
                            :style="holdProgressStyle('disable')"
                            aria-hidden="true"
                        ></span>
                        <span v-if="loading && !status.enabled" class="chip-spinner"></span>
                        <span v-else class="flex items-center gap-2">
                            <span>Disable</span>
                            <span
                                v-if="showCooldownIndicator && cooldownTarget === 'disable'"
                                class="relative inline-flex h-5 w-5 items-center justify-center"
                            >
                                <svg viewBox="0 0 24 24" class="h-5 w-5 text-white/80" aria-hidden="true">
                                    <circle cx="12" cy="12" r="9" class="fill-none stroke-white/20" stroke-width="2"></circle>
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        class="fill-none stroke-white"
                                        stroke-width="2.5"
                                        :stroke-dasharray="cooldownCircumference"
                                        :stroke-dashoffset="cooldownDashOffset"
                                        transform="rotate(-90 12 12)"
                                    ></circle>
                                </svg>
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="chip-btn chip-btn-primary chip-btn-fixed relative overflow-hidden"
                        :disabled="disableEnableButton"
                        @pointerdown="onHoldStart('enable', $event)"
                        @pointerup="onHoldCancel"
                        @pointerleave="onHoldCancel"
                        @pointercancel="onHoldCancel"
                        @keydown.space.prevent="onKeyHoldStart('enable', $event)"
                        @keyup.space="onHoldCancel"
                        @keydown.enter.prevent="onKeyHoldStart('enable', $event)"
                        @keyup.enter="onHoldCancel"
                        @blur="onHoldCancel"
                        @contextmenu.prevent
                    >
                        <span
                            class="chip-btn-progress"
                            :class="{ 'opacity-100': isHoldTarget('enable') }"
                            :style="holdProgressStyle('enable')"
                            aria-hidden="true"
                        ></span>
                        <span v-if="loading && status.enabled" class="chip-spinner"></span>
                        <span v-else class="flex items-center gap-2">
                            <span>Enable</span>
                            <span
                                v-if="showCooldownIndicator && cooldownTarget === 'enable'"
                                class="relative inline-flex h-5 w-5 items-center justify-center"
                            >
                                <svg viewBox="0 0 24 24" class="h-5 w-5 text-white/80" aria-hidden="true">
                                    <circle cx="12" cy="12" r="9" class="fill-none stroke-white/20" stroke-width="2"></circle>
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        class="fill-none stroke-white"
                                        stroke-width="2.5"
                                        :stroke-dasharray="cooldownCircumference"
                                        :stroke-dashoffset="cooldownDashOffset"
                                        transform="rotate(-90 12 12)"
                                    ></circle>
                                </svg>
                            </span>
                        </span>
                    </button>
                </div>
                <div class="flex flex-wrap items-center gap-4 text-sm text-slate-300">
                    <span class="inline-flex items-center gap-2">
                        <span class="h-2 w-2 rounded-full bg-violet-400"></span>
                        Hold for 3 seconds to confirm.
                    </span>
                    <span v-if="formattedUpdatedAt" class="text-xs text-slate-400">
                        Updated {{ formattedUpdatedAt }}
                    </span>
                </div>
                <p class="text-xs text-slate-400">
                    Disabling pauses command responses but keeps the process alive.
                </p>
            </div>
        </div>
    </div>
</template>

<script>
import { formatDetailedDateTime } from "../../../utils/formatters"

const COOLDOWN_CIRCUMFERENCE = 2 * Math.PI * 9
const TOGGLE_HOLD_DURATION_MS = 3000

export default {
    name: "BotStatusCard",
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
            default: TOGGLE_HOLD_DURATION_MS
        }
    },
    data() {
        return {
            forceUpdating: false,
            updatingTimeout: null,
            hold: {
                active: false,
                target: null,
                start: null,
                progress: 0,
                frameId: null,
                timeoutId: null,
                resetTimeout: null
            }
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
        },
        cooldownActive(newVal) {
            if (newVal) {
                this.cancelHold(true)
            }
        },
        status() {
            this.cancelHold(true)
        }
    },
    beforeDestroy() {
        if (this.updatingTimeout) {
            clearTimeout(this.updatingTimeout)
        }
        this.cancelHold(true)
    },
    computed: {
        cooldownCircumference() {
            return COOLDOWN_CIRCUMFERENCE
        },
        statusAvailable() {
            return this.status && typeof this.status.enabled === "boolean"
        },
        isUpdating() {
            return this.loading || this.forceUpdating || !this.statusAvailable
        },
        statusLabel() {
            if (this.isUpdating) return "Updating"
            return this.status.enabled ? "Online" : "Offline"
        },
        cardStateClass() {
            return this.isUpdating ? "ring-1 ring-amber-400/30" : ""
        },
        statusPillClass() {
            if (this.isUpdating) return "chip-pill-warning"
            return this.status.enabled ? "chip-pill-success" : "chip-pill-danger"
        },
        statusKey() {
            if (this.isUpdating) return "updating"
            return this.status.enabled ? "enabled" : "disabled"
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
        statusMetrics() {
            const ready = this.metricsReady
            const mysqlAlive = this.mysqlStatus
            const latencyValue = ready && typeof this.status.latency === "number"
                ? Math.round(this.status.latency)
                : null
            return [
                {
                    key: "latency",
                    label: "Gateway latency",
                    display: ready ? (latencyValue !== null ? `${latencyValue} ms` : "N/A") : null,
                    toneClass: latencyValue !== null && latencyValue > 250 ? "chip-text-warning" : "",
                    ready
                },
                {
                    key: "mysql",
                    label: "MySQL",
                    display: ready ? (mysqlAlive ? "Online" : "Offline") : null,
                    toneClass: !mysqlAlive && ready ? "chip-text-danger" : "",
                    ready
                },
                {
                    key: "updated",
                    label: "Last update",
                    display: ready ? this.formattedUpdatedAt : null,
                    toneClass: "",
                    ready
                }
            ]
        },
        showCooldownIndicator() {
            return this.cooldownActive && this.cooldownDuration > 0
        },
        cooldownRatio() {
            if (!this.showCooldownIndicator) return 0
            const ratio = this.cooldownRemaining / this.cooldownDuration
            return Math.min(1, Math.max(0, ratio))
        },
        cooldownDashOffset() {
            if (!this.showCooldownIndicator) return this.cooldownCircumference
            return this.cooldownCircumference * (1 - this.cooldownRatio)
        },
        disableDisableButton() {
            if (this.loading || this.cooldownActive) return true
            if (!this.statusAvailable) return true
            return !this.status.enabled
        },
        disableEnableButton() {
            if (this.loading || this.cooldownActive) return true
            if (!this.statusAvailable) return true
            return this.status.enabled
        },
        holdDurationMs() {
            const value = Number(this.toggleHoldDuration)
            if (Number.isFinite(value) && value > 0) {
                return value
            }
            return TOGGLE_HOLD_DURATION_MS
        }
    },
    methods: {
        toggle(enabled) {
            this.$emit("toggle", enabled)
        },
        isHoldTarget(target) {
            return this.hold.target === target && (this.hold.active || this.hold.progress > 0)
        },
        holdProgressStyle(target) {
            const progress = this.hold.target === target ? this.hold.progress : 0
            const clamped = Math.max(0, Math.min(1, progress))
            return {
                transform: `scaleX(${clamped})`
            }
        },
        onHoldStart(target, event) {
            if (event && event.buttons === 0 && event.pointerType === "mouse") {
                return
            }
            if (this.isHoldDisabled(target)) return
            if (this.hold.active) {
                this.cancelHold(true)
            }
            this.hold.active = true
            this.hold.target = target
            this.hold.start = performance.now()
            this.hold.progress = 0
            if (this.hold.frameId) cancelAnimationFrame(this.hold.frameId)
            if (this.hold.timeoutId) clearTimeout(this.hold.timeoutId)
            if (this.hold.resetTimeout) {
                clearTimeout(this.hold.resetTimeout)
                this.hold.resetTimeout = null
            }
            const step = (timestamp) => {
                if (!this.hold.active) return
                const elapsed = timestamp - this.hold.start
                const ratio = Math.min(1, elapsed / this.holdDurationMs)
                this.hold.progress = ratio
                if (ratio < 1) {
                    this.hold.frameId = requestAnimationFrame(step)
                }
            }
            this.hold.frameId = requestAnimationFrame(step)
            this.hold.timeoutId = setTimeout(() => {
                this.finishHold(true)
            }, this.holdDurationMs)
        },
        onKeyHoldStart(target, event) {
            if (event && event.repeat) return
            this.onHoldStart(target)
        },
        onHoldCancel() {
            if (this.hold.active) {
                this.finishHold(false)
            }
        },
        finishHold(triggerAction) {
            if (this.hold.frameId) {
                cancelAnimationFrame(this.hold.frameId)
                this.hold.frameId = null
            }
            if (this.hold.timeoutId) {
                clearTimeout(this.hold.timeoutId)
                this.hold.timeoutId = null
            }
            const target = this.hold.target
            const shouldTrigger = triggerAction && !!target
            this.hold.active = false
            if (shouldTrigger) {
                this.hold.progress = 1
                this.hold.resetTimeout = setTimeout(() => {
                    this.resetHoldState()
                }, 400)
                this.toggle(target === "enable")
            } else {
                this.resetHoldState()
            }
            this.hold.target = null
        },
        cancelHold(force = false) {
            if (!this.hold.active && !force) return
            this.finishHold(false)
        },
        resetHoldState() {
            this.hold.progress = 0
            this.hold.active = false
            if (this.hold.resetTimeout) {
                clearTimeout(this.hold.resetTimeout)
                this.hold.resetTimeout = null
            }
        },
        isHoldDisabled(target) {
            if (target === "enable") {
                return this.disableEnableButton
            }
            if (target === "disable") {
                return this.disableDisableButton
            }
            return true
        }
    }
}
</script>
