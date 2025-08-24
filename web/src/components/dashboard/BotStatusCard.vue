<template>
    <div class="card">
        <div class="card__header">
            <div>
                <h3 class="card__title">Stato bot</h3>
                <p class="card__subtitle">
                    Controlla la disponibilità del bot e verifica lo stato dei servizi collegati.
                </p>
            </div>
            <span class="status-pill" :class="statusClass">
                {{ statusLabel }}
            </span>
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
            <p v-if="loading" class="status-note status-note--loading">
                ⏳ Operazione in corso, attendere fino a 10 secondi...
            </p>
        </div>

        <div class="card__actions">
            <button
                class="button button--secondary"
                :disabled="loading || !status.enabled"
                @click="toggle(false)"
            >
                <span v-if="loading && !status.enabled" class="button__spinner"></span>
                <span v-else>Spegni bot</span>
            </button>
            <button
                class="button button--primary"
                :disabled="loading || status.enabled"
                @click="toggle(true)"
            >
                <span v-if="loading && status.enabled" class="button__spinner"></span>
                <span v-else>Accendi bot</span>
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
        }
    },
    computed: {
        statusAvailable() {
            return this.status && typeof this.status.enabled === "boolean"
        },
        statusLabel() {
            if (this.loading || !this.statusAvailable) return "Aggiornamento…"
            return this.status.enabled ? "Online" : "Offline"
        },
        statusClass() {
            if (this.loading || !this.statusAvailable) return "status-pill--warning"
            return this.status.enabled ? "status-pill--success" : "status-pill--danger"
        },
        mysqlStatus() {
            const health = this.status && this.status.health
            const mysql = health && health.mysql
            return Boolean(mysql && mysql.alive)
        },
        formattedUpdatedAt() {
            return this.statusAvailable ? readableFormat(this.status.updatedAt) : "N/D"
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
.status-note--loading {
    margin-top: 12px;
    padding: 10px 14px;
    background: rgba(250, 204, 21, 0.15);
    border-left: 3px solid #fbbf24;
    border-radius: 6px;
    color: #fef08a;
    font-weight: 500;
    animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.7;
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
</style>
