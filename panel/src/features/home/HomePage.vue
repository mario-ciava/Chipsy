<template>
    <div class="flex flex-col gap-10">

        <section v-if="isAuthenticated" class="space-y-8">
            <div class="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                <ProfileOverviewCard
                    :username="userName"
                    :metrics="profileMetrics"
                    :extra-metrics="profileExtraMetrics"
                    :has-profile="hasProfileStats"
                    :next-reward="profileNextReward"
                    :refreshing="profileRefreshing"
                    :empty-copy="profileEmptyCopy"
                    :avatar-url="profileAvatarUrl"
                    @refresh="refreshProfile"
                />
                <article class="chip-card chip-stack">
                    <header class="chip-card__header">
                        <div class="chip-stack">
                            <div class="flex items-center gap-2">
                                <span class="chip-eyebrow">Quick actions</span>
                                <span
                                    class="chip-info-dot"
                                    role="img"
                                    tabindex="0"
                                    aria-label="Shortcut info"
                                    data-tooltip="Single-click helpers for invite flows and access reviews."
                                ></span>
                            </div>
                            <h2 class="chip-card__title">Handy shortcuts</h2>
                            <p class="chip-card__subtitle chip-card__subtitle--tight">
                                Trigger your go-to admin gestures without loading the full dashboard.
                            </p>
                        </div>
                    </header>
                    <div class="chip-divider chip-divider--strong my-1.5"></div>
                    <ul class="chip-stack divide-y divide-white/5">
                        <li class="flex flex-col gap-2 pt-3 first:pt-0 lg:flex-row lg:items-center lg:justify-between">
                            <div class="flex-1">
                                <h4 class="text-base font-semibold text-white">Invite Chipsy</h4>
                                <p class="text-sm text-slate-300">
                                    Drop the bot into any server where you already have permissions.
                                </p>
                            </div>
                            <div class="inline-flex w-full items-start justify-start gap-2 lg:w-auto">
                                <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="button" @click="openGenericInvite">
                                    Launch
                                </button>
                            </div>
                        </li>
                        <li class="flex flex-col gap-2 pt-3 lg:flex-row lg:items-center lg:justify-between">
                            <div class="flex-1">
                                <h4 class="text-base font-semibold text-white">Moderator toolkit</h4>
                                <p class="text-sm text-slate-300">
                                    Quick macros for mod-level tasks, rolling out soon.
                                </p>
                            </div>
                            <div class="inline-flex w-full items-start justify-start gap-2 lg:w-auto">
                                <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="button" disabled>
                                    Soon
                                </button>
                            </div>
                        </li>
                        <li class="flex flex-col gap-2 pt-3 lg:flex-row lg:items-center lg:justify-between">
                            <div class="flex-1">
                                <h4 class="text-base font-semibold text-white">Audit queue</h4>
                                <p class="text-sm text-slate-300">
                                    Placeholder for on-demand reports and status digests.
                                </p>
                            </div>
                            <div class="inline-flex w-full items-start justify-start gap-2 lg:w-auto">
                                <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="button" disabled>
                                    Locked
                                </button>
                            </div>
                        </li>
                    </ul>
                </article>
            </div>

            <section class="space-y-3">
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

        <section v-else class="space-y-6">
            <article
                class="chip-card chip-stack bg-gradient-to-br from-violet-600/20 via-slate-900/80 to-indigo-900/40 text-center lg:text-left"
            >
                <header class="chip-card__header">
                    <div class="chip-stack text-left">
                        <span class="chip-eyebrow">
                            {{ whyChipsyContent.eyebrow || whyChipsyContent.tagline || "WHY CHIPSY" }}
                        </span>
                        <h3 class="chip-card__title">{{ whyChipsyContent.headline || "Why Chipsy" }}</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            {{ whyChipsyContent.body || "Chipsy keeps Discord-native casinos synchronized across bot, panel, and data." }}
                        </p>
                    </div>
                </header>
                <div class="grid gap-4 lg:grid-cols-3">
                    <section
                        v-for="pillar in whyChipsyPillars"
                        :key="pillar.title"
                        class="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                        <div class="flex items-center gap-2 text-white">
                            <span class="text-xl">{{ pillar.icon }}</span>
                            <p class="text-base font-semibold">{{ pillar.title }}</p>
                        </div>
                        <p class="text-sm text-slate-300">{{ pillar.copy }}</p>
                        <ul class="space-y-1 pl-5 text-sm text-slate-300">
                            <li
                                v-for="bullet in pillar.bullets"
                                :key="bullet"
                                class="list-disc marker:text-violet-400"
                            >
                                {{ bullet }}
                            </li>
                        </ul>
                    </section>
                </div>
                <div class="chip-divider chip-divider--strong my-2"></div>
                <div class="flex flex-wrap gap-2">
                    <span
                        v-for="badge in whyChipsyBadges"
                        :key="badge.label"
                        class="chip-pill chip-pill-ghost flex flex-wrap items-center gap-2"
                    >
                        <span class="text-sm font-semibold text-white normal-case">{{ badge.label }}</span>
                        <span class="text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-slate-300">
                            {{ badge.detail }}
                        </span>
                    </span>
                </div>
            </article>

            <div class="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <article class="chip-card chip-stack">
                    <header class="chip-card__header">
                        <div class="chip-stack">
                            <span class="chip-eyebrow">
                                {{ launchPlaybook.eyebrow || launchPlaybook.tagline || "LAUNCH PLAYBOOK" }}
                            </span>
                            <h3 class="chip-card__title">{{ launchPlaybook.title || "Launch playbook" }}</h3>
                            <p class="chip-card__subtitle chip-card__subtitle--tight">
                                {{ launchPlaybook.subtitle || "Borrow our onboarding steps to bring Chipsy live." }}
                            </p>
                        </div>
                    </header>
                    <ol class="chip-stack">
                        <li
                            v-for="(step, index) in launchSteps"
                            :key="step.title"
                            class="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                        >
                            <span
                                class="chip-pill-metric inline-flex h-10 w-10 flex-shrink-0 items-center justify-center p-0 text-base"
                            >
                                {{ index + 1 }}
                            </span>
                            <div class="chip-stack text-left">
                                <p class="text-base font-semibold text-white">{{ step.title }}</p>
                                <p class="text-sm text-slate-300">{{ step.detail }}</p>
                            </div>
                        </li>
                    </ol>
                </article>

                <article class="chip-card chip-stack">
                    <header class="chip-card__header">
                        <div class="chip-stack">
                            <span class="chip-eyebrow">
                                {{ readinessContent.eyebrow || readinessContent.tagline || "OPERATIONAL READINESS" }}
                            </span>
                            <h3 class="chip-card__title">{{ readinessContent.title || "Operational readiness" }}</h3>
                            <p class="chip-card__subtitle chip-card__subtitle--tight">
                                {{ readinessContent.subtitle || "Preview the guardrails that keep guilds healthy." }}
                            </p>
                        </div>
                    </header>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <div
                            v-for="stat in readinessStats"
                            :key="stat.label"
                            class="chip-stat chip-stat--inline"
                        >
                            <span class="chip-stat__label">{{ stat.label }}</span>
                            <span class="chip-stat__value">{{ stat.value }}</span>
                            <p class="text-xs text-slate-400">{{ stat.detail }}</p>
                        </div>
                    </div>
                    <div class="chip-divider chip-divider--strong my-1"></div>
                    <ul class="chip-stack divide-y divide-white/5">
                        <li
                            v-for="assurance in readinessAssurances"
                            :key="assurance.tag"
                            class="grid gap-3 pt-3 first:pt-0 sm:grid-cols-[200px_1fr] sm:items-center"
                        >
                            <div class="flex justify-center">
                                <span
                                    class="chip-pill chip-pill-info flex h-11 w-48 items-center justify-center text-center text-sm tracking-[0.28em]"
                                >
                                    {{ assurance.tag }}
                                </span>
                            </div>
                            <p class="text-sm text-slate-300">
                                {{ assurance.detail }}
                            </p>
                        </li>
                    </ul>
                </article>
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
import GuildOverview from "../dashboard/components/GuildOverview.vue"
import ProfileOverviewCard from "./components/ProfileOverviewCard.vue"
import api from "../../services/api"
import { formatCurrency, formatExpRange, formatFriendlyDateTime } from "../../utils/formatters"
import { getControlPanelRedirect } from "../../utils/runtime"
import homeMarketing from "../../config/homeContent"

const INVITE_BASE = "https://discord.com/api/oauth2/authorize"
const PROFILE_REFRESH_INTERVAL_MS = 20000
const landingMarketing = homeMarketing || {}

export default {
    name: "HomePage",
    components: {
        GuildOverview,
        ProfileOverviewCard
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
            profileRefreshing: false,
            profileAutoRefreshing: false,
            profileAutoRefreshId: null
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user", "canViewLogs", "panelConfig"]),
        marketingContent() {
            return landingMarketing
        },
        whyChipsyContent() {
            return this.marketingContent.whyChipsy || {}
        },
        whyChipsyPillars() {
            return Array.isArray(this.whyChipsyContent.pillars) ? this.whyChipsyContent.pillars : []
        },
        whyChipsyBadges() {
            return Array.isArray(this.whyChipsyContent.badges) ? this.whyChipsyContent.badges : []
        },
        launchPlaybook() {
            return this.marketingContent.playbook || {}
        },
        launchSteps() {
            return Array.isArray(this.launchPlaybook.steps) ? this.launchPlaybook.steps : []
        },
        readinessContent() {
            return this.marketingContent.readiness || {}
        },
        readinessStats() {
            return Array.isArray(this.readinessContent.stats) ? this.readinessContent.stats : []
        },
        readinessAssurances() {
            return Array.isArray(this.readinessContent.assurances) ? this.readinessContent.assurances : []
        },
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
            if (!this.profileStats?.nextReward) return "Available"
            return formatFriendlyDateTime(this.profileStats.nextReward)
        },
        profileAvatarUrl() {
            if (!this.user?.id) return ""
            const userData = this.user
            if (userData.avatar) {
                return `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png?size=80`
            }
            const discriminator = Number(userData.discriminator) || 0
            const fallbackIndex = discriminator % 5
            return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png?size=80`
        },
        hasProfileStats() {
            return Boolean(this.profileStats)
        },
        profileMetrics() {
            if (!this.profileStats) return []
            return [
                {
                    key: "balance",
                    label: "Balance",
                    display: this.formattedBalance,
                    hint: "Spendable chips",
                    toneClass: "chip-status__value--primary"
                },
                {
                    key: "gold",
                    label: "Gold",
                    display: `${this.profileStats.gold || 0}`,
                    hint: "Premium currency",
                    toneClass: "chip-status__value--accent"
                },
                {
                    key: "level",
                    label: "Level",
                    display: `${this.profileStats.level || 1}`,
                    hint: this.formattedExp,
                    toneClass: "chip-status__value--info"
                },
                {
                    key: "activity",
                    label: "Last activity",
                    display: this.profileLastPlayed,
                    hint: "Reward timeline below"
                }
            ]
        },
        profileExtraMetrics() {
            if (!this.profileStats) return []
            const handsPlayed = Number(this.profileStats.handsPlayed) || 0
            const handsWon = Number(this.profileStats.handsWon) || 0
            const winRate = handsPlayed > 0 ? (handsWon / handsPlayed) * 100 : null
            const biggestBet = Number(this.profileStats.biggestBet) || 0
            const biggestWon = Number(this.profileStats.biggestWon) || 0
            let playerSince = "Unknown"
            if (this.profileStats.joinDate) {
                const formattedJoin = formatFriendlyDateTime(this.profileStats.joinDate)
                playerSince = formattedJoin.includes(" at ")
                    ? formattedJoin.split(" at ")[0]
                    : formattedJoin
            }

            return [
                {
                    key: "hands-played",
                    label: "Hands played",
                    display: handsPlayed.toLocaleString(),
                    hint: "Lifetime rounds"
                },
                {
                    key: "hands-won",
                    label: "Hands won",
                    display: handsWon.toLocaleString(),
                    hint: "Across all games"
                },
                {
                    key: "biggest-bet",
                    label: "Biggest bet",
                    display: formatCurrency(biggestBet, { currencySymbol: "chips" }),
                    hint: "Single wager"
                },
                {
                    key: "biggest-win",
                    label: "Biggest win",
                    display: formatCurrency(biggestWon, { currencySymbol: "chips" }),
                    hint: "Largest payout"
                },
                {
                    key: "win-rate",
                    label: "W/L ratio",
                    display: winRate !== null ? `${winRate.toFixed(1)}%` : "N/A",
                    hint: "Win percentage"
                },
                {
                    key: "player-since",
                    label: "Player since",
                    display: playerSince,
                    hint: "First Chipsy session"
                }
            ]
        },
        profileEmptyCopy() {
            return "We could not find Chipsy stats for this account yet. Play a game to create the profile."
        },
        profileRefreshInterval() {
            const customInterval = this.panelConfig?.experience?.profileRefreshIntervalMs
            if (typeof customInterval === "number" && customInterval > 0) {
                return customInterval
            }
            return PROFILE_REFRESH_INTERVAL_MS
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
                this.startProfileAutoRefresh()
            } else {
                this.stopProfileAutoRefresh()
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
            this.startProfileAutoRefresh()
        }
        document.addEventListener("visibilitychange", this.handleVisibilityChange)
    },
    beforeDestroy() {
        this.stopProfileAutoRefresh()
        document.removeEventListener("visibilitychange", this.handleVisibilityChange)
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
        async refreshProfile({ silent = false } = {}) {
            if (silent) {
                if (this.profileAutoRefreshing || this.profileRefreshing) return
                this.profileAutoRefreshing = true
            } else {
                if (this.profileRefreshing || this.profileAutoRefreshing) return
                this.profileRefreshing = true
            }
            try {
                await this.$store.dispatch("session/refreshSession")
                if (!silent) {
                    this.pushToast("Profile information updated.")
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to refresh profile", error)
                if (!silent) {
                    this.pushToast("Unable to refresh profile information.")
                }
            } finally {
                if (silent) {
                    this.profileAutoRefreshing = false
                } else {
                    this.profileRefreshing = false
                }
            }
        },
        startProfileAutoRefresh() {
            if (this.profileAutoRefreshId || !this.isAuthenticated) return
            this.refreshProfile({ silent: true })
            this.profileAutoRefreshId = setInterval(() => {
                if (document.hidden || this.profileRefreshing) return
                this.refreshProfile({ silent: true })
            }, this.profileRefreshInterval)
        },
        stopProfileAutoRefresh() {
            if (this.profileAutoRefreshId) {
                clearInterval(this.profileAutoRefreshId)
                this.profileAutoRefreshId = null
            }
            this.profileAutoRefreshing = false
        },
        handleVisibilityChange() {
            if (!document.hidden) {
                this.refreshProfile({ silent: true })
            }
        }
    }
}
</script>
