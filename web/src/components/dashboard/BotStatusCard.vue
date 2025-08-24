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
        </div>

        <div class="card__actions">
            <button
                class="button button--secondary"
                :disabled="loading || !status.enabled"
                @click="toggle(false)"
            >
                Spegni bot
            </button>
            <button
                class="button button--primary"
                :disabled="loading || status.enabled"
                @click="toggle(true)"
            >
                Accendi bot
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
