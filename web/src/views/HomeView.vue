<template>
    <div class="page page--centered home">
        <header class="page__header home__hero">
            <h1 class="page__title">Chipsy Control Panel</h1>
            <p class="page__subtitle home__subtitle">
                Gestisci Chipsy con un click: controlla lo stato del bot, monitora i dati MySQL e invita l’assistente nei tuoi server Discord.
            </p>
        </header>

        <section class="page__section home__section">
            <div class="card card--highlight home__card">
                <template v-if="!isAuthenticated">
                    <h2 class="card__title">Accedi con Discord</h2>
                    <p class="card__body">
                        Collegati con il tuo account per aprire il pannello di controllo. Solo gli amministratori autorizzati possono abilitare o sospendere Chipsy e consultare le statistiche della community.
                    </p>
                    <div class="home__cta">
                        <button class="button button--primary home__cta-button" @click="goToLogin" :disabled="processing">
                            <span v-if="processing">Reindirizzamento in corso…</span>
                            <span v-else>Accedi con Discord</span>
                        </button>
                    </div>
                </template>
                <template v-else-if="isAdmin">
                    <h2 class="card__title">Bentornato, {{ userName }}</h2>
                    <p class="card__body">
                        Sei pronto a gestire Chipsy. Apri il pannello per abilitare o sospendere il bot, invitare nuovi server e consultare i dati live.
                    </p>
                    <div class="home__cta">
                        <router-link to="/control_panel" class="button button--primary home__cta-button">
                            Vai al pannello
                        </router-link>
                    </div>
                </template>
                <template v-else>
                    <h2 class="card__title">Accesso completato</h2>
                    <p class="card__body">
                        Il tuo account è autenticato, ma non dispone dei permessi amministrativi necessari per il pannello. Continua a usare i comandi di Chipsy direttamente da Discord oppure contatta un admin per ottenere l’accesso.
                    </p>
                </template>
            </div>

            <div class="card home__features">
                <h3 class="card__title">Cosa offre il pannello</h3>
                <ul class="features-list">
                    <li>
                        <strong>Controllo live:</strong> abilita o sospendi l’uso dei comandi in tempo reale, senza riavviare il bot.
                    </li>
                    <li>
                        <strong>Dashboard utenti:</strong> consulta le metriche MySQL sincronizzate con i comandi `/profile` e monitora i progressi dei player.
                    </li>
                    <li>
                        <strong>Inviti centralizzati:</strong> invita Chipsy in nuovi server e verifica lo stato delle integrazioni senza uscire dal browser.
                    </li>
                </ul>
            </div>

            <div v-if="processing" class="page__status home__status">
                Stiamo convalidando l’accesso…
            </div>

            <transition name="fade">
                <div v-if="errorMessage" class="page__error">
                    {{ errorMessage }}
                </div>
            </transition>
        </section>
    </div>
</template>

<script>
import { mapGetters } from "vuex"

export default {
    name: "HomeView",
    data() {
        return {
            processing: false,
            errorMessage: null
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user"]),
        loginCode() {
            return this.$route.query.code || null
        },
        userName() {
            return this.user && this.user.username ? this.user.username : ""
        }
    },
    watch: {
        loginCode(code) {
            if (code) {
                this.handleOAuthCode(code)
            }
        },
        isAuthenticated(newValue) {
            if (newValue) {
                this.onAuthenticated()
            }
        }
    },
    created() {
        if (this.loginCode) {
            this.handleOAuthCode(this.loginCode)
        }
    },
    methods: {
        onAuthenticated() {
            if (this.isAdmin) {
                this.$router.replace({ name: "ControlPanel" }).catch(() => {})
            }
        },
        async handleOAuthCode(code) {
            this.processing = true
            this.errorMessage = null
            try {
                await this.$store.dispatch("session/completeLogin", code)
                if (this.$store.getters["session/isAdmin"]) {
                    try {
                        await this.$store.dispatch("bot/fetchStatus")
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to load bot status", error)
                    }
                    try {
                        await this.$store.dispatch("users/fetchUsers")
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to load users", error)
                    }
                }
                this.onAuthenticated()
            } catch (error) {
                this.errorMessage = "Impossibile completare l'accesso. Riprova più tardi."
                // eslint-disable-next-line no-console
                console.error("OAuth exchange failed", error)
            } finally {
                this.processing = false
            }
        },
        goToLogin() {
            this.$router.push({ name: "Login" })
        }
    }
}
</script>
