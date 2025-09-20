<template>
    <div class="page user-detail">
        <div class="card user-detail__card">
            <header class="user-detail__header">
                <div>
                    <h1 class="user-detail__title">User profile</h1>
                    <p class="user-detail__subtitle">
                        Overview of the data stored in MySQL for <strong>{{ userId }}</strong>.
                    </p>
                </div>
                <router-link to="/control_panel" class="button button--ghost">
                    ← Back to the panel
                </router-link>
            </header>

            <div v-if="loading" class="user-detail__loading">Loading data…</div>
            <div v-else-if="error" class="user-detail__error">{{ error }}</div>
            <div v-else class="user-detail__grid">
                <section>
                    <h2 class="user-detail__section-title">Balances</h2>
                    <ul class="user-detail__list">
                        <li><span>Balance</span><strong>{{ formatted.money }}</strong></li>
                        <li><span>Gold</span><strong>{{ formatted.gold }}</strong></li>
                        <li><span>Biggest win</span><strong>{{ formatted.biggestWon }}</strong></li>
                        <li><span>Biggest bet</span><strong>{{ formatted.biggestBet }}</strong></li>
                    </ul>
                </section>
                <section>
                    <h2 class="user-detail__section-title">Progression</h2>
                    <ul class="user-detail__list">
                        <li><span>Level</span><strong>{{ formatted.level }}</strong></li>
                        <li><span>Exp</span><strong>{{ formatted.exp }}</strong></li>
                        <li><span>Win rate</span><strong>{{ formatted.winRate }}</strong></li>
                        <li><span>Last activity</span><strong>{{ formatted.lastPlayed }}</strong></li>
                    </ul>
                </section>
                <section>
                    <h2 class="user-detail__section-title">Quick actions</h2>
                    <div class="user-detail__actions">
                        <p class="user-detail__actions-hint">These actions will unlock in a future iteration.</p>
                        <button type="button" class="button button--secondary" disabled>Send bonus</button>
                        <button type="button" class="button button--ghost" disabled>Reset stats</button>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<script>
import api from "../../services/api"
import {
    formatCurrency,
    formatPercentage,
    formatExpRange,
    formatDetailedDateTime
} from "../../utils/formatters"

export default {
    name: "UserDetailPage",
    data() {
        return {
            loading: true,
            error: null,
            user: null
        }
    },
    computed: {
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
                exp: formatExpRange(user.current_exp, user.required_exp),
                winRate: formatPercentage(user.winRate),
                lastPlayed: formatDetailedDateTime(user.last_played)
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
                const data = await api.getUserById({ id: this.userId })
                this.user = data
            } catch (error) {
                this.error = "Unable to fetch that user's details."
            } finally {
                this.loading = false
            }
        }
    }
}
</script>
