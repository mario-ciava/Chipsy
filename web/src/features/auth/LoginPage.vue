<template>
    <div class="page page--centered">
        <header class="page__header">
            <h1 class="page__title">Login required</h1>
            <p class="page__subtitle">
                You&apos;ll be redirected to Discord&apos;s authorization page to finish signing in.
            </p>
        </header>
        <section class="page__section login">
            <div class="card login__card">
                <template v-if="clientId">
                    <p class="card__body">
                        If the Discord login doesn&apos;t open automatically, trigger it manually.
                    </p>
                    <div class="login__cta">
                        <button type="button" class="button button--secondary" @click="openAuth">
                            Open Discord authorization
                        </button>
                    </div>
                    <p class="card__body card__body--muted login__redirect">
                        Configured redirect: <code>{{ redirectTarget }}</code>
                    </p>
                </template>
                <p v-else class="card__body card__body--warning">
                    Configure <code>VUE_APP_DISCORD_CLIENT_ID</code> to enable login.
                </p>
            </div>
        </section>
    </div>
</template>

<script>
import { getRuntimeOrigin } from "../../utils/runtime"

export default {
    name: "LoginPage",
    computed: {
        clientId() {
            return process.env.VUE_APP_DISCORD_CLIENT_ID
        },
        redirectTarget() {
            return getRuntimeOrigin()
        },
        redirectUri() {
            return encodeURIComponent(this.redirectTarget)
        },
        authUrl() {
            const base = "https://discordapp.com/api/oauth2/authorize"
            return `${base}?client_id=${this.clientId}&redirect_uri=${this.redirectUri}&response_type=code&scope=identify%20guilds`
        }
    },
    created() {
        if (!this.clientId) {
            // eslint-disable-next-line no-console
            console.error("Missing VUE_APP_DISCORD_CLIENT_ID environment variable.")
            return
        }
        window.location.href = this.authUrl
    },
    methods: {
        openAuth() {
            window.location.href = this.authUrl
        }
    }
}
</script>
