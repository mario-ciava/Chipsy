<template>
    <div class="page user-detail">
        <div class="card user-detail__card">
            <header class="user-detail__header">
                <div>
                    <h1 class="user-detail__title">Profilo utente</h1>
                    <p class="user-detail__subtitle">
                        Visione generale dei dati memorizzati nel database MySQL per <strong>{{ userId }}</strong>.
                    </p>
                </div>
                <router-link to="/control_panel" class="button button--ghost">
                    ← Torna al pannello
                </router-link>
            </header>

            <div v-if="loading" class="user-detail__loading">Caricamento dati…</div>
            <div v-else-if="error" class="user-detail__error">{{ error }}</div>
            <div v-else class="user-detail__grid">
                <section>
                    <h2 class="user-detail__section-title">Bilanci</h2>
                    <ul class="user-detail__list">
                        <li><span>Saldo</span><strong>{{ formatted.money }}</strong></li>
                        <li><span>Oro</span><strong>{{ formatted.gold }}</strong></li>
                        <li><span>Biggest win</span><strong>{{ formatted.biggestWon }}</strong></li>
                        <li><span>Biggest bet</span><strong>{{ formatted.biggestBet }}</strong></li>
                    </ul>
                </section>
                <section>
                    <h2 class="user-detail__section-title">Progressione</h2>
                    <ul class="user-detail__list">
                        <li><span>Livello</span><strong>{{ formatted.level }}</strong></li>
                        <li><span>Exp</span><strong>{{ formatted.exp }}</strong></li>
                        <li><span>Win rate</span><strong>{{ formatted.winRate }}</strong></li>
                        <li><span>Ultima attività</span><strong>{{ formatted.lastPlayed }}</strong></li>
                    </ul>
                </section>
                <section>
                    <h2 class="user-detail__section-title">Azioni rapide</h2>
                    <div class="user-detail__actions">
                        <p class="user-detail__actions-hint">Queste azioni verranno abilitate nelle prossime iterazioni.</p>
                        <button type="button" class="button button--secondary" disabled>Invia bonus</button>
                        <button type="button" class="button button--ghost" disabled>Reset statistiche</button>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<script>
import { mapGetters } from "vuex"
import api from "../services/api"

const formatCurrency = (value) => `${Number(value || 0).toLocaleString("it-IT")} $`
const formatPercentage = (value) => `${Number(value || 0).toFixed(2)} %`
const formatExp = (current, required) => `${Number(current || 0).toLocaleString("it-IT")} / ${Number(required || 0).toLocaleString("it-IT")}`
const formatDate = (value) => {
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
        return `${dateFormatter.format(date).replace("di ", "")} ${timeFormatter.format(date)}`
    } catch (error) {
        return "N/D"
    }
}

export default {
    name: "UserDetailView",
    data() {
        return {
            loading: true,
            error: null,
            user: null
        }
    },
    computed: {
        ...mapGetters("session", ["token", "csrfToken"]),
        userId() {
            return this.$route.params.id
        },
        formatted() {
            const user = this.user || {}
            return {
                money: formatCurrency(user.money),
                gold: formatCurrency(user.gold),
                biggestWon: formatCurrency(user.biggest_won),
                biggestBet: formatCurrency(user.biggest_bet),
                level: user.level !== undefined ? user.level : 0,
                exp: formatExp(user.current_exp, user.required_exp),
                winRate: formatPercentage(user.winRate),
                lastPlayed: formatDate(user.last_played)
            }
        }
    },
    async created() {
        await this.loadUser()
    },
    methods: {
        async loadUser() {
            this.loading = true
            this.error = null
            try {
                const token = this.$store.state.session.token
                if (!token) {
                    this.error = "Sessione non valida."
                    return
                }
                const data = await api.getUserById({ token, id: this.userId })
                this.user = data
            } catch (error) {
                this.error = "Impossibile recuperare i dettagli dell'utente."
            } finally {
                this.loading = false
            }
        }
    }
}
</script>
