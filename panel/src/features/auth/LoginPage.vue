<template>
    <div class="mx-auto flex w-full max-w-lg flex-col gap-6 rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center shadow-chip-card">
        <header class="space-y-2">
            <h1 class="text-3xl font-semibold text-white">Login required</h1>
            <p class="text-sm text-slate-300">
                You&apos;ll be redirected to Discord&apos;s authorization page to finish signing in.
            </p>
        </header>
        <section class="space-y-3">
            <template v-if="clientId">
                <p class="text-sm text-slate-300">
                    If the Discord login doesn&apos;t open automatically, trigger it manually.
                </p>
                <button type="button" class="chip-btn chip-btn-secondary w-full justify-center" @click="openAuth">
                    Open Discord authorization
                </button>
                <p class="text-xs text-slate-400">
                    Configured redirect: <code class="font-mono text-slate-200">{{ redirectTarget }}</code>
                </p>
            </template>
            <p v-else class="chip-notice chip-notice-warning text-sm text-center">
                Configure <code>VUE_APP_DISCORD_CLIENT_ID</code> to enable login.
            </p>
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
