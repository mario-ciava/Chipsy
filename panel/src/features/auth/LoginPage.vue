<template>
    <div class="chip-shell">
        <div class="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <article class="chip-card chip-stack flex-1">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">Control panel access</span>
                        <h1 class="chip-card__title">Sign in with Discord</h1>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            Chipsy relies on Discord OAuth2. We never see your password, and permissions stay exactly as you approve them.
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong my-2"></div>
                <section class="chip-stack">
                    <template v-if="clientId">
                        <button
                            type="button"
                            class="chip-btn chip-btn-secondary w-full justify-center"
                            :disabled="launching"
                            @click="openAuth"
                        >
                            <span v-if="launching" class="chip-spinner mr-2"></span>
                            <span>Sign in with Discord</span>
                        </button>
                        <button
                            type="button"
                            class="chip-btn chip-btn-ghost w-full justify-center"
                            @click="goBack"
                        >
                            Back
                        </button>
                        <p class="chip-field-hint text-center text-slate-400">
                            We&apos;ll launch Discord automatically, but you can retry manually if it doesn&apos;t open.
                        </p>
                    </template>
                    <p v-else class="chip-notice chip-notice-warning text-center text-sm">
                        Configure <code>VUE_APP_DISCORD_CLIENT_ID</code> to enable login.
                    </p>
                </section>
            </article>
            <article class="chip-card chip-card-muted chip-stack flex-1">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">What to expect</span>
                        <h2 class="chip-card__title">Fast, secure redirect</h2>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            We only request the scopes needed to identify you and read managed guilds.
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong my-2"></div>
                <ul class="chip-stack text-sm text-slate-300">
                    <li
                        v-for="(item, index) in loginSteps"
                        :key="item.title"
                        class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                        <span class="chip-pill-metric inline-flex h-8 w-8 flex-shrink-0 items-center justify-center p-0 text-xs">
                            {{ index + 1 }}
                        </span>
                        <div class="chip-stack text-left">
                            <p class="text-base font-semibold text-white">{{ item.title }}</p>
                            <p class="text-sm text-slate-300">{{ item.detail }}</p>
                        </div>
                    </li>
                </ul>
            </article>
        </div>
    </div>
</template>

<script>
import { getRuntimeOrigin, rememberPostLoginRoute } from "../../utils/runtime"

export default {
    name: "LoginPage",
    data() {
        return {
            launching: false,
            autoLaunchTimer: null,
            loginSteps: [
                {
                    title: "Grant Chipsy visibility",
                    detail: "Discord shows you the scopes we request (identify + guilds) and nothing else."
                },
                {
                    title: "Complete OAuth2",
                    detail: "We exchange the authorization code for a Chipsy session behind the scenes."
                },
                {
                    title: "Return safely",
                    detail: "If you change your mind, use the back button to jump out instantly."
                }
            ]
        }
    },
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
    mounted() {
        if (this.clientId) {
            this.scheduleAutoLaunch()
        }
        if (this.$route?.query?.redirect) {
            rememberPostLoginRoute(this.$route.query.redirect)
        }
    },
    beforeDestroy() {
        if (this.autoLaunchTimer) {
            clearTimeout(this.autoLaunchTimer)
            this.autoLaunchTimer = null
        }
    },
    methods: {
        scheduleAutoLaunch() {
            if (this.autoLaunchTimer) {
                clearTimeout(this.autoLaunchTimer)
            }
            this.autoLaunchTimer = setTimeout(() => {
                if (!this.launching) {
                    this.openAuth()
                }
            }, 250)
        },
        openAuth() {
            if (!this.clientId) {
                // eslint-disable-next-line no-console
                console.error("Missing VUE_APP_DISCORD_CLIENT_ID environment variable.")
                return
            }
            if (this.launching) {
                return
            }
            rememberPostLoginRoute(this.$route?.query?.redirect || "/")
            this.launching = true
            window.location.href = this.authUrl
        },
        goBack() {
            if (window.history.length > 1) {
                this.$router.back()
            } else {
                this.$router.push({ name: "Home" }).catch(() => {})
            }
        }
    }
}
</script>
