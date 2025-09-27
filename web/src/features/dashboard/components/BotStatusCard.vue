<template>
    <div :class="['card', 'bot-status-card', { 'card--updating': isUpdating }]">
        <div class="card__header">
            <div>
                <h3 class="card__title">Bot status</h3>
                <p class="card__subtitle">
                    Check bot availability and the health of its dependencies.
                </p>
            </div>
            <div class="card__status">
                <transition name="status-flip" mode="out-in">
                    <span
                        :key="statusKey"
                        class="status-pill"
                        :class="statusClass"
                    >
                        {{ statusLabel }}
                    </span>
                </transition>
            </div>
        </div>

        <div class="card__body">
            <ul class="status-list status-grid">
                <li v-for="metric in statusMetrics" :key="metric.key">
                    <span class="status-list__label">{{ metric.label }}</span>
                    <span
                        class="status-list__value"
                        :class="[metric.className, { 'status-list__value--loading': !metric.ready }]"
                    >
                        <template v-if="metric.ready">
                            {{ metric.display }}
                        </template>
                        <span v-else class="status-list__placeholder" aria-hidden="true"></span>
                    </span>
                </li>
            </ul>
        </div>

        <div class="bot-status-card__footer">
            <div class="card__actions bot-status-card__actions">
                <button
                    type="button"
                    class="button button--secondary button--fixed-width"
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
                        class="button__hold-progress"
                        :class="{ 'button__hold-progress--active': isHoldTarget('disable') }"
                        :style="holdProgressStyle('disable')"
                        aria-hidden="true"
                    ></span>
                    <span v-if="loading && !status.enabled" class="button__spinner"></span>
                    <span v-else class="button__content">
                        <span>Disable</span>
                        <span
                            v-if="showCooldownIndicator && cooldownTarget === 'disable'"
                            class="button__cooldown"
                        >
                            <svg viewBox="0 0 24 24" class="button__cooldown-svg" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" class="button__cooldown-track" />
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    class="button__cooldown-progress"
                                    :stroke-dasharray="cooldownCircumference"
                                    :stroke-dashoffset="cooldownDashOffset"
                                />
                            </svg>
                        </span>
                    </span>
                </button>
                <button
                    type="button"
                    class="button button--primary button--fixed-width"
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
                        class="button__hold-progress"
                        :class="{ 'button__hold-progress--active': isHoldTarget('enable') }"
                        :style="holdProgressStyle('enable')"
                        aria-hidden="true"
                    ></span>
                    <span v-if="loading && status.enabled" class="button__spinner"></span>
                    <span v-else class="button__content">
                        <span>Enable</span>
                        <span
                            v-if="showCooldownIndicator && cooldownTarget === 'enable'"
                            class="button__cooldown"
                        >
                            <svg viewBox="0 0 24 24" class="button__cooldown-svg" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" class="button__cooldown-track" />
                                <circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    class="button__cooldown-progress"
                                    :stroke-dasharray="cooldownCircumference"
                                    :stroke-dashoffset="cooldownDashOffset"
                                />
                            </svg>
                        </span>
                    </span>
                </button>
            </div>
            <div class="bot-status-card__guidance">
                <p class="bot-status-card__instruction">
                    <span class="bot-status-card__instruction-icon" aria-hidden="true"></span>
                    Hold for 3 seconds to confirm.
                </p>
                <p class="bot-status-card__note">
                    Disables command responses; the process stays alive.
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
        statusClass() {
            if (this.isUpdating) return "status-pill--warning"
            return this.status.enabled ? "status-pill--success" : "status-pill--danger"
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
                    className: latencyValue !== null && latencyValue > 250 ? "status-list__value--warning" : null,
                    ready
                },
                {
                    key: "mysql",
                    label: "MySQL",
                    display: ready ? (mysqlAlive ? "Online" : "Offline") : null,
                    className: !mysqlAlive && ready ? "status-list__value--error" : null,
                    ready
                },
                {
                    key: "updated",
                    label: "Last update",
                    display: ready ? this.formattedUpdatedAt : null,
                    className: null,
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

<style scoped>
.bot-status-card {
    position: relative;
    overflow: hidden;
    transition: transform 0.4s ease, box-shadow 0.4s ease;
}

.bot-status-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
}

.card--updating::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 0% 0%, rgba(251, 191, 36, 0.12), transparent 55%),
        radial-gradient(circle at 100% 0%, rgba(251, 146, 60, 0.12), transparent 55%);
    pointer-events: none;
    animation: shimmer 2s ease-in-out infinite;
}

.card--updating {
    box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.18);
}

.status-pill {
    position: relative;
    transition: transform 0.35s ease, background 0.35s ease, color 0.35s ease;
}

.card--updating .status-pill {
    transform: translateY(0);
    animation: pulse 1.6s ease-in-out infinite;
}

.status-flip-enter-active,
.status-flip-leave-active {
    transition: opacity 0.25s ease;
}

.status-flip-enter-from,
.status-flip-leave-to {
    opacity: 0;
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.7;
    }
}

@keyframes shimmer {
    0%,
    100% {
        opacity: 0.55;
    }
    50% {
        opacity: 0.9;
    }
}

@keyframes wave-motion {
    0% {
        transform: translate(-55%, -58%) rotate(0deg);
    }
    50% {
        transform: translate(-45%, -62%) rotate(2deg);
    }
    100% {
        transform: translate(-35%, -58%) rotate(0deg);
    }
}
.button__content {
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.button__cooldown {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.button__cooldown-svg {
    width: 20px;
    height: 20px;
}

.button__cooldown-track {
    fill: none;
    stroke: rgba(255, 255, 255, 0.2);
    stroke-width: 2;
}

.button__cooldown-progress {
    fill: none;
    stroke: #fff;
    stroke-width: 2.5;
    transform-origin: center;
    transform: rotate(-90deg);
    transition: stroke-dashoffset 0.12s ease-out;
}

.button--fixed-width {
    width: 148px;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
}

.card__status {
    min-width: 156px;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
}

.card__status .status-pill {
    min-width: 100%;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    text-align: center;
}
</style>
