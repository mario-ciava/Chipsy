<template>
    <div :class="['card', 'bot-status-card', { 'card--updating': isUpdating }]">
        <div class="card__header">
            <div class="card__header-main">
                <div class="card__title-row">
                    <h3 class="card__title">Stato bot</h3>
                    <div class="bot-status-card__info-hint">
                        <button
                            type="button"
                            class="bot-status-card__info-button"
                            :aria-describedby="infoTooltipIds.bot"
                            aria-label="Modifica la risposta ai comandi, mantenendo il processo attivo"
                        >
                            <span aria-hidden="true">i</span>
                        </button>
                        <span
                            :id="infoTooltipIds.bot"
                            class="bot-status-card__tooltip"
                            role="tooltip"
                        >
                            Modifica la risposta ai comandi, mantenendo il processo attivo
                        </span>
                    </div>
                </div>
                <p class="card__subtitle">
                    Controlla la disponibilità del bot e verifica lo stato dei servizi collegati.
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
                <li>
                    <span class="status-list__label">Server Discord attivi</span>
                    <span class="status-list__value">{{ status.guildCount || 0 }}</span>
                </li>
                <li>
                    <span class="status-list__label">Ultimo aggiornamento</span>
                    <span class="status-list__value">{{ formattedUpdatedAt }}</span>
                </li>
            </ul>
        </div>

        <div class="bot-status-card__footer">
            <div class="bot-status-card__controls">
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
                            <span>Disabilita</span>
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
                            <span>Abilita</span>
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
            </div>
            <div class="bot-status-card__process-block">
                <div class="bot-status-card__process-header">
                    <div class="bot-status-card__process-heading">
                        <div class="bot-status-card__process-title-row">
                            <h3 class="bot-status-card__process-title">Stato processi</h3>
                            <div class="bot-status-card__info-hint">
                                <button
                                    type="button"
                                    class="bot-status-card__info-button bot-status-card__info-button--subtle"
                                    :aria-describedby="infoTooltipIds.process"
                                    aria-label="Monitora i servizi di supporto e termina il processo principale quando necessario"
                                >
                                    <span aria-hidden="true">i</span>
                                </button>
                                <span
                                    :id="infoTooltipIds.process"
                                    class="bot-status-card__tooltip"
                                    role="tooltip"
                                >
                                    Monitora i servizi di supporto e termina il processo principale quando necessario
                                </span>
                            </div>
                        </div>
                        <p class="bot-status-card__process-subtitle">
                            Gestisci il processo principale del bot e i servizi collegati.
                        </p>
                    </div>
                    <div class="bot-status-card__process-status">
                        <transition name="status-flip" mode="out-in">
                            <span
                                :key="processStatusKey"
                                class="status-pill"
                                :class="processStatusClass"
                            >
                                {{ processStatusLabel }}
                            </span>
                        </transition>
                    </div>
                </div>

                <ul class="bot-status-card__process-list">
                    <li class="bot-status-card__process-row">
                        <div class="bot-status-card__process-details">
                            <span class="bot-status-card__process-name">Processo bot</span>
                            <span
                                class="bot-status-card__process-state"
                                :class="botProcessStateClass"
                            >
                                {{ botProcessStatusLabel }}
                            </span>
                        </div>
                        <div class="bot-status-card__process-actions">
                            <button
                                type="button"
                                class="button button--danger button--fixed-width"
                                :disabled="disableKillBotButton"
                                @pointerdown="onHoldStart('kill-bot', $event)"
                                @pointerup="onHoldCancel"
                                @pointerleave="onHoldCancel"
                                @pointercancel="onHoldCancel"
                                @keydown.space.prevent="onKeyHoldStart('kill-bot', $event)"
                                @keyup.space="onHoldCancel"
                                @keydown.enter.prevent="onKeyHoldStart('kill-bot', $event)"
                                @keyup.enter="onHoldCancel"
                                @blur="onHoldCancel"
                                @contextmenu.prevent
                            >
                                <span
                                    class="button__hold-progress"
                                    :class="{ 'button__hold-progress--active': isHoldTarget('kill-bot') }"
                                    :style="holdProgressStyle('kill-bot')"
                                    aria-hidden="true"
                                ></span>
                                <span v-if="killLoading && pendingKillTarget === 'kill-bot'" class="button__spinner"></span>
                                <span v-else class="button__content">Termina</span>
                            </button>
                        </div>
                    </li>
                    <li class="bot-status-card__process-row">
                        <div class="bot-status-card__process-details">
                            <span class="bot-status-card__process-name">MySQL</span>
                            <span
                                class="bot-status-card__process-state"
                                :class="mysqlProcessStateClass"
                            >
                                {{ mysqlStatus ? "Online" : "Offline" }}
                            </span>
                        </div>
                        <div class="bot-status-card__process-actions">
                            <button
                                type="button"
                                class="button button--danger button--fixed-width"
                                :disabled="disableKillMysqlButton"
                                @pointerdown="onHoldStart('kill-mysql', $event)"
                                @pointerup="onHoldCancel"
                                @pointerleave="onHoldCancel"
                                @pointercancel="onHoldCancel"
                                @keydown.space.prevent="onKeyHoldStart('kill-mysql', $event)"
                                @keyup.space="onHoldCancel"
                                @keydown.enter.prevent="onKeyHoldStart('kill-mysql', $event)"
                                @keyup.enter="onHoldCancel"
                                @blur="onHoldCancel"
                                @contextmenu.prevent
                            >
                                <span
                                    class="button__hold-progress"
                                    :class="{ 'button__hold-progress--active': isHoldTarget('kill-mysql') }"
                                    :style="holdProgressStyle('kill-mysql')"
                                    aria-hidden="true"
                                ></span>
                                <span v-if="killLoading && pendingKillTarget === 'kill-mysql'" class="button__spinner"></span>
                                <span v-else class="button__content">Termina</span>
                            </button>
                        </div>
                    </li>
                </ul>
            </div>

            <div class="bot-status-card__guidance">
                <p class="bot-status-card__instruction">
                    <span class="bot-status-card__instruction-icon" aria-hidden="true"></span>
                    Tieni premuto per confermare l'azione.
                </p>
            </div>
        </div>
    </div>
</template>

<script>
const readableFormat = (value) => {
    if (!value) return "N/D"
    try {
        const date = new Date(value)
        const dateFormatter = new Intl.DateTimeFormat("it-IT", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        })
        const timeFormatter = new Intl.DateTimeFormat("it-IT", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        })

        const formattedDate = dateFormatter.format(date).replace("di ", "")
        return `${formattedDate} ${timeFormatter.format(date)}`
    } catch {
        return "N/D"
    }
}

const COOLDOWN_CIRCUMFERENCE = 2 * Math.PI * 9

const uniqueId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`

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
        killLoading: {
            type: Boolean,
            default: false
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
            },
            holdDuration: 3000,
            infoTooltipIds: {
                bot: uniqueId("bot-info"),
                process: uniqueId("process-info")
            },
            pendingKillTarget: null
        }
    },
    watch: {
        loading(newVal, oldVal) {
            // Quando loading diventa true, forza "Aggiornamento" per 5 secondi
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
        killLoading(newVal) {
            if (!newVal) {
                this.pendingKillTarget = null
            }
        },
        status() {
            this.cancelHold(true)
            this.pendingKillTarget = null
        }
    },
    beforeUnmount() {
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
            if (this.isUpdating) return "Aggiornamento"
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
        processStatusState() {
            const process = this.status?.health?.process
            if (process && typeof process.alive === "boolean") {
                return process.alive ? "alive" : "stopped"
            }
            if (this.statusAvailable) {
                return this.status.enabled ? "alive" : "standby"
            }
            return "unknown"
        },
        processStatusLabel() {
            switch (this.processStatusState) {
                case "alive":
                    return "Attivo"
                case "stopped":
                    return "Terminato"
                case "standby":
                    return "In standby"
                default:
                    return "Sconosciuto"
            }
        },
        processStatusClass() {
            switch (this.processStatusState) {
                case "alive":
                    return "status-pill--success"
                case "stopped":
                    return "status-pill--danger"
                default:
                    return "status-pill--warning"
            }
        },
        processStatusKey() {
            return this.processStatusState
        },
        formattedUpdatedAt() {
            return this.statusAvailable ? readableFormat(this.status.updatedAt) : "N/D"
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
        botProcessStatusLabel() {
            switch (this.processStatusState) {
                case "alive":
                    return "Online"
                case "stopped":
                    return "Offline"
                case "standby":
                    return "In standby"
                default:
                    return "Sconosciuto"
            }
        },
        botProcessStateClass() {
            switch (this.processStatusState) {
                case "alive":
                    return "bot-status-card__process-state--success"
                case "stopped":
                    return "bot-status-card__process-state--danger"
                case "standby":
                    return "bot-status-card__process-state--muted"
                default:
                    return "bot-status-card__process-state--warning"
            }
        },
        mysqlProcessStateClass() {
            return this.mysqlStatus
                ? "bot-status-card__process-state--success"
                : "bot-status-card__process-state--danger"
        },
        disableKillBotButton() {
            if (this.killLoading) return true
            return this.processStatusState !== "alive"
        },
        disableKillMysqlButton() {
            if (this.killLoading) return true
            return !this.mysqlStatus
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
            const translate = 100 - progress * 100
            return {
                transform: `translateY(${translate}%)`
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
                const ratio = Math.min(1, elapsed / this.holdDuration)
                this.hold.progress = ratio
                if (ratio < 1) {
                    this.hold.frameId = requestAnimationFrame(step)
                }
            }
            this.hold.frameId = requestAnimationFrame(step)
            this.hold.timeoutId = setTimeout(() => {
                this.finishHold(true)
            }, this.holdDuration)
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
                this.triggerHoldAction(target)
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
            if (target === "kill-bot") {
                return this.disableKillBotButton
            }
            if (target === "kill-mysql") {
                return this.disableKillMysqlButton
            }
            return true
        },
        triggerHoldAction(target) {
            switch (target) {
                case "enable":
                    this.toggle(true)
                    break
                case "disable":
                    this.toggle(false)
                    break
                case "kill-bot":
                    this.pendingKillTarget = "kill-bot"
                    this.$emit("kill", { target: "bot" })
                    break
                case "kill-mysql":
                    this.pendingKillTarget = "kill-mysql"
                    this.$emit("kill", { target: "mysql" })
                    if (!this.killLoading) {
                        this.$nextTick(() => {
                            if (!this.killLoading) {
                                this.pendingKillTarget = null
                            }
                        })
                    }
                    break
                default:
                    break
            }
        }
    }
}
</script>

<style scoped>
.bot-status-card {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
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

.button__spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
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
    white-space: nowrap;
}

.button__hold-progress {
    position: absolute;
    inset: 0;
    background: radial-gradient(120% 80% at 50% 110%, rgba(255, 255, 255, 0.45), transparent 65%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.05));
    opacity: 0.65;
    transform: translateY(100%);
    transition: transform 0.12s linear, opacity 0.3s ease;
    pointer-events: none;
    mix-blend-mode: screen;
}

.button__hold-progress--active {
    opacity: 0.75;
}

.button--secondary .button__hold-progress {
    background: radial-gradient(120% 80% at 50% 110%, rgba(148, 163, 184, 0.6), transparent 65%),
        linear-gradient(180deg, rgba(148, 163, 184, 0.4), rgba(148, 163, 184, 0.15));
    mix-blend-mode: normal;
}

.card__header-main {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.card__title-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.card__title-row .card__title {
    margin: 0;
}

.bot-status-card__footer {
    display: flex;
    flex-direction: column;
    gap: 24px;
    margin-top: auto;
}

.bot-status-card__controls {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
}

.bot-status-card__actions {
    gap: 16px;
}

.bot-status-card__info-hint {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.bot-status-card__info-button {
    border: none;
    background: radial-gradient(circle at 30% 30%, rgba(148, 163, 184, 0.9), rgba(100, 116, 139, 0.8));
    color: #0f172a;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 0.75rem;
    cursor: help;
    box-shadow: 0 4px 14px rgba(15, 23, 42, 0.3);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.bot-status-card__info-button--subtle {
    box-shadow: 0 3px 10px rgba(15, 23, 42, 0.25);
    background: radial-gradient(circle at 30% 30%, rgba(148, 163, 184, 0.85), rgba(100, 116, 139, 0.7));
}

.bot-status-card__info-button span {
    pointer-events: none;
}

.bot-status-card__info-button:focus-visible {
    outline: 2px solid rgba(148, 163, 184, 0.8);
    outline-offset: 2px;
}

.bot-status-card__info-button:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.35);
}

.bot-status-card__tooltip {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translate(-50%, 2px);
    background: rgba(15, 23, 42, 0.95);
    color: rgba(226, 232, 240, 0.92);
    font-size: 0.75rem;
    line-height: 1.2;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    box-shadow: 0 16px 30px rgba(15, 23, 42, 0.55);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.18s ease;
    max-width: 240px;
    width: max-content;
    text-align: center;
    z-index: 2;
}

.bot-status-card__tooltip::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    width: 12px;
    height: 8px;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.95);
    clip-path: polygon(50% 100%, 0 0, 100% 0);
}

.bot-status-card__info-hint:focus-within .bot-status-card__tooltip,
.bot-status-card__info-hint:hover .bot-status-card__tooltip {
    opacity: 1;
    transform: translate(-50%, -4px);
}

.bot-status-card__process-block {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 18px;
    border-radius: var(--radius-lg);
    background: linear-gradient(135deg, rgba(30, 41, 59, 0.75), rgba(30, 41, 59, 0.45));
    border: 1px solid rgba(148, 163, 184, 0.18);
}

.bot-status-card__process-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
}

.bot-status-card__process-heading {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.bot-status-card__process-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.bot-status-card__process-title {
    margin: 0;
    font-size: 1.1rem;
    color: #f8fafc;
}

.bot-status-card__process-subtitle {
    margin: 0;
    font-size: 0.9rem;
    color: rgba(226, 232, 240, 0.75);
}

.bot-status-card__process-status {
    display: flex;
    align-items: center;
}

.bot-status-card__process-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 14px;
}

.bot-status-card__process-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
}

.bot-status-card__process-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.bot-status-card__process-name {
    font-weight: 600;
    color: var(--fg-secondary);
    font-size: 0.95rem;
}

.bot-status-card__process-state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
}

.bot-status-card__process-state::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
}

.bot-status-card__process-state--success {
    color: #bbf7d0;
}

.bot-status-card__process-state--danger {
    color: #fecaca;
}

.bot-status-card__process-state--warning {
    color: #fed7aa;
}

.bot-status-card__process-state--muted {
    color: rgba(226, 232, 240, 0.75);
}

.bot-status-card__process-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
}

.bot-status-card__guidance {
    margin-top: auto;
    padding-top: 16px;
    display: grid;
    gap: 6px;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.bot-status-card__instruction,
.bot-status-card__note {
    margin: 0;
    font-size: 0.85rem;
    color: rgba(226, 232, 240, 0.78);
    display: flex;
    align-items: center;
    gap: 8px;
}

.bot-status-card__instruction {
    font-weight: 600;
    color: rgba(226, 232, 240, 0.92);
}

.bot-status-card__instruction-icon {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: linear-gradient(135deg, #fbbf24, #f97316);
    box-shadow: 0 0 10px rgba(251, 146, 60, 0.45);
}

.bot-status-card__note {
    color: rgba(148, 163, 184, 0.78);
}

@media (max-width: 768px) {
    .bot-status-card__actions {
        flex-direction: column;
        align-items: stretch;
    }

    .button--fixed-width {
        width: 100%;
    }

    .bot-status-card__process-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
    }

    .bot-status-card__process-actions {
        justify-content: flex-start;
    }
}
</style>
