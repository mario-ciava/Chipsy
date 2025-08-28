<template>
    <div :class="['card', 'bot-status-card', { 'card--updating': isUpdating }]">
        <div class="card__header">
            <div>
                <h3 class="card__title">Stato bot</h3>
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
                    <span class="status-list__label">MySQL</span>
                    <span class="status-list__value" :class="{ 'status-list__value--error': !mysqlStatus }">
                        {{ mysqlStatus ? "Online" : "Offline" }}
                    </span>
                </li>
                <li>
                    <span class="status-list__label">Ultimo aggiornamento</span>
                    <span class="status-list__value">{{ formattedUpdatedAt }}</span>
                </li>
            </ul>
            <p class="status-note">
                Disattiva le risposte ai comandi; il processo resta attivo.
            </p>
        </div>

        <div class="card__actions">
            <button
                class="button button--secondary button--fixed-width"
                :disabled="disableDisableButton"
                @click="toggle(false)"
            >
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
                class="button button--primary button--fixed-width"
                :disabled="disableEnableButton"
                @click="toggle(true)"
            >
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
        }
    },
    data() {
        return {
            forceUpdating: false,
            updatingTimeout: null
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
        }
    },
    beforeUnmount() {
        if (this.updatingTimeout) {
            clearTimeout(this.updatingTimeout)
        }
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
        }
    },
    methods: {
        toggle(enabled) {
            this.$emit("toggle", enabled)
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
    width: 140px;
    flex-shrink: 0;
}

.card__status {
    width: 156px;
    height: 32px;
    display: flex;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;
}

.card__status .status-pill {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    text-align: center;
}
</style>
