<template>
    <div class="flex flex-col gap-10">
        <header class="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-600/20 via-slate-900/80 to-indigo-900/40 p-8 text-center shadow-chip-card lg:text-left">
            <div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div class="space-y-4">
                    <span v-if="isAuthenticated" class="chip-pill chip-pill-info self-start">
                        {{ roleLabel }} access
                    </span>
                    <h1 class="text-4xl font-semibold text-white">Chipsy Control Center</h1>
                    <p class="text-base text-slate-200">
                        Monitor the bot, surface player stats, and drop Chipsy into Discord servers without touching a terminal.
                    </p>
                </div>
                <div class="flex flex-wrap items-center justify-center gap-3">
                    <button
                        v-if="!isAuthenticated"
                        class="chip-btn chip-btn-primary min-w-[200px]"
                        @click="goToLogin"
                        :disabled="processing"
                    >
                        <span v-if="processing">Redirecting…</span>
                        <span v-else>Sign in with Discord</span>
                    </button>
                    <template v-else>
                        <router-link
                            v-if="isAdmin"
                            to="/control_panel"
                            class="chip-btn chip-btn-primary min-w-[180px]"
                        >
                            Open the panel
                        </router-link>
                        <router-link
                            v-if="canViewLogs"
                            to="/logs"
                            class="chip-btn chip-btn-secondary min-w-[160px]"
                        >
                            View logs
                        </router-link>
                    </template>
                </div>
            </div>
        </header>

        <section v-if="isAuthenticated" class="space-y-8">
            <div class="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                <article class="chip-card space-y-6">
                    <header class="flex items-center justify-between gap-3">
                        <div>
                            <h2 class="chip-card__title">Your Chipsy profile</h2>
                            <p class="chip-card__subtitle">
                                The same data exposed by the in-Discord <code>/profile</code> command.
                            </p>
                        </div>
                        <span class="chip-pill chip-pill-ghost">@{{ userName || 'unknown' }}</span>
                    </header>
                    <div v-if="profileStats" class="grid gap-4 md:grid-cols-2">
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="chip-label">Balance</p>
                            <p class="text-2xl font-semibold text-white">{{ formattedBalance }}</p>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="chip-label">Gold</p>
                            <p class="text-2xl font-semibold text-white">{{ profileStats.gold || 0 }}</p>
                            <p class="text-xs text-slate-400">Premium currency</p>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="chip-label">Level</p>
                            <p class="text-2xl font-semibold text-white">Lv. {{ profileStats.level || 1 }}</p>
                            <p class="text-xs text-slate-400">{{ formattedExp }}</p>
                        </div>
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="chip-label">Last activity</p>
                            <p class="text-base font-semibold text-white">{{ profileLastPlayed }}</p>
                            <p class="text-xs text-slate-400">Next reward {{ profileNextReward }}</p>
                        </div>
                    </div>
                    <p v-else class="chip-empty">
                        We could not find Chipsy stats for this account yet. Play a game to create the profile.
                    </p>
                    <div class="flex justify-end">
                        <button class="chip-btn chip-btn-ghost" type="button" :disabled="profileRefreshing" @click="refreshProfile">
                            <span v-if="profileRefreshing" class="chip-spinner"></span>
                            <span v-else>Refresh info</span>
                        </button>
                    </div>
                </article>
                <article class="chip-card space-y-4">
                    <h2 class="chip-card__title">Handy shortcuts</h2>
                    <ul class="space-y-3 text-sm text-slate-200">
                        <li class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="font-semibold text-white">Invite Chipsy</p>
                            <p class="text-slate-300">Open Discord&apos;s OAuth flow and pick one of your managed servers.</p>
                            <button class="chip-btn chip-btn-secondary mt-3 w-full" type="button" @click="openGenericInvite">
                                Launch invite
                            </button>
                        </li>
                        <li class="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <p class="font-semibold text-white">Review panel policy</p>
                            <p class="text-slate-300">Check whitelist enforcement and server permissions.</p>
                            <router-link to="/control_panel" class="chip-btn chip-btn-ghost mt-3 w-full">
                                Open dashboard
                            </router-link>
                        </li>
                    </ul>
                </article>
            </div>

            <section class="space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-xl font-semibold text-white">Servers you can manage</h3>
                        <p class="text-sm text-slate-300">Active and invite-ready guilds pulled straight from Discord.</p>
                    </div>
                    <span class="chip-pill chip-pill-ghost">
                        {{ guilds.added.length }} active · {{ guilds.available.length }} invite-ready
                    </span>
                </div>
                <div v-if="guildNotice" class="chip-notice chip-notice-warning">
                    {{ guildNotice }}
                </div>
                <GuildOverview
                    :guilds="guilds"
                    :loading="guildsLoading"
                    :show-leave="isAdmin"
                    @leave="leaveGuild"
                />
            </section>
        </section>

        <section v-else class="grid gap-6 lg:grid-cols-2">
            <div class="chip-card space-y-4">
                <h2 class="chip-card__title">Sign in with Discord</h2>
                <p class="text-sm text-slate-300">
                    Use your account to unlock the control panel. Only approved admins can enable or suspend Chipsy and review community stats.
                </p>
                <button class="chip-btn chip-btn-primary w-full" @click="goToLogin" :disabled="processing">
                    <span v-if="processing">Redirecting…</span>
                    <span v-else>Authenticate</span>
                </button>
            </div>
            <div class="chip-card space-y-4">
                <h3 class="chip-card__title">Why Chipsy</h3>
                <ul class="space-y-3 text-sm text-slate-200">
                    <li>
                        <strong>Casino workflow:</strong> blackjack, texas hold&apos;em, and other games with a bankroll shared between bot and panel.
                    </li>
                    <li>
                        <strong>Player progression:</strong> levels, auto-rewards, and stats kept in sync with MySQL.
                    </li>
                    <li>
                        <strong>Discord-native:</strong> sane invite flows, permissions, and slash commands tuned for communities.
                    </li>
                </ul>
            </div>
        </section>

        <div v-if="processing" class="chip-notice chip-notice-info">
            Validating your access…
        </div>

        <transition name="fade">
            <div v-if="errorMessage" class="chip-notice chip-notice-warning">
                {{ errorMessage }}
            </div>
        </transition>
    </div>
</template>

<script>
import { mapGetters } from "vuex"
import { getRoleLabel } from "../../constants/roles"
import GuildOverview from "../dashboard/components/GuildOverview.vue"
import api from "../../services/api"
import { formatCurrency, formatExpRange, formatFriendlyDateTime } from "../../utils/formatters"
import { getControlPanelRedirect } from "../../utils/runtime"

const INVITE_BASE = "https://discord.com/api/oauth2/authorize"

export default {
    name: "HomePage",
    components: {
        GuildOverview
    },
    data() {
        return {
            processing: false,
            errorMessage: null,
            guilds: {
                added: [],
                available: []
            },
            guildsMeta: null,
            guildsLoading: false,
            guildNotice: null,
            profileRefreshing: false
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user", "canViewLogs", "role"]),
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
        },
        roleLabel() {
            return getRoleLabel(this.role)
        },
        profileStats() {
            return this.user?.profile || null
        },
        formattedBalance() {
            return formatCurrency(this.profileStats?.money || 0, { currencySymbol: "chips" })
        },
        formattedExp() {
            if (!this.profileStats) return "0 / 0"
            return formatExpRange(this.profileStats.currentExp, this.profileStats.requiredExp)
        },
        profileLastPlayed() {
            if (!this.profileStats?.lastPlayed) return "No games logged"
            return formatFriendlyDateTime(this.profileStats.lastPlayed)
        },
        profileNextReward() {
            if (!this.profileStats?.nextReward) return "queued"
            return formatFriendlyDateTime(this.profileStats.nextReward)
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
                this.loadHomeData()
            }
        },
        user(newValue, oldValue) {
            if (newValue?.id && newValue.id !== oldValue?.id) {
                this.loadHomeData()
            }
        }
    },
    created() {
        if (this.loginCode) {
            this.handleOAuthCode(this.loginCode)
        } else if (this.isAuthenticated) {
            this.loadHomeData()
        }
    },
    methods: {
        onAuthenticated() {
            if (this.isAdmin) {
                this.$router.replace({ name: "ControlPanel" }).catch(() => {})
            } else if (this.canViewLogs) {
                this.$router.replace({ name: "Logs" }).catch(() => {})
            }
        },
        async handleOAuthCode(code) {
            this.processing = true
            this.errorMessage = null
            try {
                await this.$store.dispatch("session/completeLogin", code)
                if (this.$store.getters["session/isAdmin"]) {
                    await this.$store.dispatch("bot/fetchStatus").catch(() => null)
                    await this.$store.dispatch("users/fetchUsers").catch(() => null)
                }
                this.onAuthenticated()
                this.loadHomeData()
            } catch (error) {
                this.errorMessage = "Unable to complete the login. Try again later."
                // eslint-disable-next-line no-console
                console.error("OAuth exchange failed", error)
            } finally {
                this.processing = false
            }
        },
        async loadHomeData() {
            if (!this.isAuthenticated) return
            this.loadGuilds()
        },
        async loadGuilds() {
            this.guildsLoading = true
            try {
                const guilds = await api.getGuilds()
                const meta = guilds?.meta || {}
                this.guildsMeta = meta

                const added = Array.isArray(guilds.added) ? guilds.added : []
                const availableRaw = Array.isArray(guilds.available) ? guilds.available : []
                const addedIds = new Set(added.map((guild) => guild.id))
                const available = availableRaw.filter((guild) => !addedIds.has(guild.id))
                this.guilds = { added, available }

                if (meta.rateLimited) {
                    this.guildNotice = "Discord is throttling the guild list. Showing cached data."
                } else if (meta.cooldown) {
                    this.guildNotice = "Refreshing the guild list too quickly. Cached data is temporarily shown."
                } else {
                    this.guildNotice = null
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load guilds", error)
                this.guildNotice = null
                this.errorMessage = this.errorMessage || "Unable to load your server list."
            } finally {
                this.guildsLoading = false
            }
        },
        async leaveGuild(id) {
            if (!this.isAdmin || !id) return
            const csrfToken = this.$store.state.session.csrfToken
            if (!csrfToken) return
            try {
                await api.leaveGuild({ csrfToken, guildId: id })
                this.pushToast("Chipsy has been removed from the selected server.")
                await this.loadGuilds()
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to leave guild", error)
                this.pushToast("Unable to remove Chipsy from that server.")
            }
        },
        pushToast(message) {
            if (!message) return
            window.dispatchEvent(new CustomEvent("chipsy-toast", { detail: { message } }))
        },
        buildInviteUrl() {
            const clientId = process.env.VUE_APP_DISCORD_CLIENT_ID
            if (!clientId) return "#"
            const redirect = encodeURIComponent(getControlPanelRedirect())
            const permissions = process.env.VUE_APP_DISCORD_INVITE_PERMISSIONS || "2147483648"
            return `${INVITE_BASE}?client_id=${clientId}&redirect_uri=${redirect}&response_type=code&scope=bot%20applications.commands&permissions=${permissions}&state=homeQuickInvite`
        },
        openGenericInvite() {
            const url = this.buildInviteUrl()
            if (url === "#") return
            window.open(url, "_blank", "noopener,noreferrer")
        },
        async refreshProfile() {
            if (this.profileRefreshing) return
            this.profileRefreshing = true
            try {
                await this.$store.dispatch("session/refreshSession")
                this.pushToast("Profile information updated.")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to refresh profile", error)
                this.pushToast("Unable to refresh profile information.")
            } finally {
                this.profileRefreshing = false
            }
        },
        goToLogin() {
            this.$router.push({ name: "Login" })
        }
    }
}
</script>

