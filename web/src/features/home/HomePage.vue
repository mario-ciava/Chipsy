<template>
    <div class="page page--centered home">
        <header class="page__header home__hero">
            <h1 class="page__title">Chipsy Control Panel</h1>
            <p class="page__subtitle home__subtitle">
                Manage Chipsy with one click: check bot status, watch MySQL data, and drop the assistant into your Discord servers.
            </p>
        </header>

        <section class="page__section home__section">
            <div class="card card--highlight home__card">
                <template v-if="!isAuthenticated">
                    <h2 class="card__title">Sign in with Discord</h2>
                    <p class="card__body">
                        Use your account to unlock the control panel. Only approved admins can enable or suspend Chipsy and review community stats.
                    </p>
                    <div class="home__cta">
                        <button class="button button--primary home__cta-button" @click="goToLogin" :disabled="processing">
                            <span v-if="processing">Redirecting…</span>
                            <span v-else>Sign in with Discord</span>
                        </button>
                    </div>
                </template>
                <template v-else-if="isAdmin">
                    <h2 class="card__title">Welcome back, {{ userName }}</h2>
                    <p class="card__body">
                        Time to babysit Chipsy. Open the panel to enable/disable the bot, invite new servers, and read live stats.
                    </p>
                    <div class="home__cta">
                        <router-link to="/control_panel" class="button button--primary home__cta-button">
                            Open the panel
                        </router-link>
                    </div>
                </template>
                <template v-else>
                    <h2 class="card__title">Access granted</h2>
                    <p class="card__body">
                        Your account is authenticated but lacks the admin role for this panel. Keep using Chipsy directly on Discord or ping an admin for elevated access.
                    </p>
                </template>
            </div>

            <div class="card home__features">
                <h3 class="card__title">Why Chipsy</h3>
                <ul class="features-list">
                    <li>
                        <strong>Casino workflow:</strong> blackjack, texas hold'em, and other games with a bankroll shared between bot and panel.
                    </li>
                    <li>
                        <strong>Player progression:</strong> levels, auto-rewards, and stats kept in sync with MySQL.
                    </li>
                    <li>
                        <strong>Discord-native:</strong> sane invite flows, permissions, and slash commands tuned for communities.
                    </li>
                </ul>
            </div>

            <div v-if="processing" class="page__status home__status">
                Validating your access…
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
    name: "HomePage",
    data() {
        return {
            processing: false,
            errorMessage: null
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user"]),
        loginState() {
            return this.$route.query.state || null
        },
        loginCode() {
            if (this.loginState === "controlPanelInvite") {
                return null
            }
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
                this.errorMessage = "Unable to complete the login. Try again later."
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
