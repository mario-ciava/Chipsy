<template>
    <div class="flex flex-col gap-10">

        <section v-if="isAuthenticated" class="space-y-8">
            <div class="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
                <ProfileOverviewCard
                    :username="userName"
                    :metrics="profileMetrics"
                    :extra-metrics="profileExtraMetrics"
                    :upgrade-metrics="profileUpgradeMetrics"
                    :timeline-metric="profileTimelineMetric"
                    :has-profile="hasProfileStats"
                    :next-reward="profileNextReward"
                    :refreshing="profileRefreshing"
                    :empty-copy="profileEmptyCopy"
                    :avatar-url="profileAvatarUrl"
                    @refresh="refreshProfile"
                />
                <div class="flex flex-col gap-6 h-full">
                    <article class="chip-card chip-stack flex-1">
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
                            <li
                                v-for="shortcut in quickShortcuts"
                                :key="shortcut.key"
                                class="flex flex-col gap-2 pt-3 first:pt-0 lg:flex-row lg:items-center lg:justify-between"
                            >
                                <div class="flex-1">
                                    <h4 class="text-base font-semibold text-white">{{ shortcut.title }}</h4>
                                    <p class="text-sm text-slate-300">{{ shortcut.description }}</p>
                                </div>
                                <div class="inline-flex w-full items-start justify-start gap-2 lg:w-auto">
                                    <button
                                        class="chip-btn chip-btn-secondary chip-btn-fixed"
                                        type="button"
                                        :disabled="shortcut.disabled"
                                        @click="handleShortcut(shortcut)"
                                    >
                                        {{ shortcut.ctaLabel || "Open" }}
                                    </button>
                                </div>
                            </li>
                            <li
                                v-if="!quickShortcuts.length"
                                class="flex flex-col gap-2 py-3 text-sm text-slate-400"
                            >
                                No shortcuts available yet.
                            </li>
                        </ul>
                    </article>
                </div>
            </div>

            <section id="home-guild-reach" ref="guildReachSection" class="space-y-3">
                <div v-if="guildNotice" class="chip-notice chip-notice-warning">
                    {{ guildNotice }}
                </div>
                <GuildOverview
                    :guilds="guilds"
                    :loading="guildsLoading"
                    :show-leave="true"
                    :can-leave-globally="canLeaveGlobally"
                    @leave="leaveGuild"
                />
            </section>

            <LeaderboardTop />

            <HomeMarketingSection
                id="home-marketing"
                :why-chipsy-content="whyChipsyContent"
                :why-chipsy-pillars="whyChipsyPillars"
                :why-chipsy-badges="whyChipsyBadges"
                :launch-playbook="launchPlaybook"
                :launch-steps="launchSteps"
                :readiness-content="readinessContent"
                :readiness-stats="readinessStats"
                :readiness-assurances="readinessAssurances"
                :guild-invite-url="communityGuildInviteUrl"
            />
        </section>

        <div v-else class="space-y-8">
            <LeaderboardTop />
            <HomeMarketingSection
                id="home-marketing"
                :why-chipsy-content="whyChipsyContent"
                :why-chipsy-pillars="whyChipsyPillars"
                :why-chipsy-badges="whyChipsyBadges"
                :launch-playbook="launchPlaybook"
                :launch-steps="launchSteps"
                :readiness-content="readinessContent"
                :readiness-stats="readinessStats"
                :readiness-assurances="readinessAssurances"
                :guild-invite-url="communityGuildInviteUrl"
            />
        </div>

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
import HomeMarketingSection from "./components/HomeMarketingSection.vue"
import LeaderboardTop from "../../components/LeaderboardTop.vue"
import api from "../../services/api"
import { formatCurrency, formatExpRange, formatFriendlyDateTime } from "../../utils/formatters"
import { getControlPanelRedirect, consumePostLoginRoute } from "../../utils/runtime"
import { hasManageGuildPermission as sharedHasManageGuildPermission, normalizeGuildList } from "../../utils/guilds"
import homeMarketing from "../../config/homeContent"
import communityContent from "../../config/communityContent"

const INVITE_BASE = "https://discord.com/api/oauth2/authorize"
const PROFILE_REFRESH_INTERVAL_MS = 20000
const landingMarketing = homeMarketing || {}
const communityLinks = communityContent || {}

const SHARED_SHORTCUTS = Object.freeze([
    {
        key: "invite",
        title: "Invite Chipsy",
        description: "Drop the bot into any server where you already have permissions.",
        ctaLabel: "Launch",
        handler: "openGenericInvite",
        roles: ["USER", "MODERATOR", "ADMIN", "MASTER"]
    },
    {
        key: "playbook",
        title: "Launch playbook",
        description: "Review the onboarding steps before inviting Chipsy anywhere else.",
        ctaLabel: "View",
        handler: "scrollToMarketing",
        roles: ["USER", "MODERATOR", "ADMIN", "MASTER"]
    },
    {
        key: "ops-placeholder",
        title: "Remote maintenance",
        description: "Reserve this slot for the upcoming remote controls shortcut.",
        ctaLabel: "Soon",
        disabled: true,
        roles: ["USER", "MODERATOR", "ADMIN", "MASTER"]
    }
])

const PROFILE_UPGRADE_METRICS = Object.freeze([
    {
        key: "withholding-upgrade",
        field: "withholdingUpgrade",
        label: "Withholding upgrade",
        hint: "Reduces jackpot taxes",
        maxLevel: 10
    },
    {
        key: "reward-amount-upgrade",
        field: "rewardAmountUpgrade",
        label: "Reward amount upgrade",
        hint: "Boosts daily payout",
        maxLevel: 10
    },
    {
        key: "reward-time-upgrade",
        field: "rewardTimeUpgrade",
        label: "Reward cooldown upgrade",
        hint: "Shortens cooldown",
        maxLevel: 5
    },
    {
        key: "win-probability-upgrade",
        field: "winProbabilityUpgrade",
        label: "Win probability insight",
        hint: "Unlocks odds preview",
        maxLevel: 1,
        formatValue: (level) => (level >= 1 ? "Unlocked" : "Locked")
    }
])

const formatUpgradeLevelDisplay = (level, maxLevel) => {
    const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 0
    if (typeof maxLevel === "number" && maxLevel > 0) {
        return `${safeLevel}/${maxLevel}`
    }
    return `${safeLevel}`
}

export default {
    name: "HomePage",
    components: {
        GuildOverview,
        ProfileOverviewCard,
        HomeMarketingSection,
        LeaderboardTop
    },
    data() {
        return {
            processing: false,
            errorMessage: null,
            guilds: {
                all: [],
                added: [],
                available: []
            },
            guildsMeta: null,
            guildsLoading: false,
            guildNotice: null,
            pendingGuildFocus: false,
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
        communityGuildInviteUrl() {
            const inviteUrl = communityLinks?.guild?.inviteUrl
            if (typeof inviteUrl !== "string" || !inviteUrl.trim()) {
                return null
            }
            try {
                return new URL(inviteUrl).toString()
            } catch (error) {
                return null
            }
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
                    toneClass: "chip-status__value--info"
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
                    toneClass: "chip-status__value--primary"
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
            const netWinnings = Number(this.profileStats.netWinnings) || 0

            const baseMetrics = [
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
                    key: "net-winnings",
                    label: "Net winnings",
                    display: formatCurrency(netWinnings, { currencySymbol: "chips" }),
                    hint: "Lifetime delta",
                    toneClass: netWinnings >= 0 ? "chip-status__value--ok" : "chip-status__value--danger"
                },
                {
                    key: "win-rate",
                    label: "W/L ratio",
                    display: winRate !== null ? `${winRate.toFixed(1)}%` : "N/A",
                    hint: "Win percentage"
                }
            ]

            return baseMetrics
        },
        profileTimelineMetric() {
            if (!this.profileStats) return null
            let playerSince = "Unknown"
            if (this.profileStats.joinDate) {
                const formattedJoin = formatFriendlyDateTime(this.profileStats.joinDate)
                playerSince = formattedJoin.includes(" at ")
                    ? formattedJoin.split(" at ")[0]
                    : formattedJoin
            }
            return {
                key: "player-since",
                label: "Player since",
                display: playerSince,
                hint: "First Chipsy session"
            }
        },
        profileUpgradeMetrics() {
            if (!this.profileStats) return []

            return PROFILE_UPGRADE_METRICS.map((definition) => {
                const rawLevel = Number(this.profileStats?.[definition.field]) || 0
                const level = rawLevel > 0 ? Math.floor(rawLevel) : 0
                const displayValue = typeof definition.formatValue === "function"
                    ? definition.formatValue(level, definition)
                    : formatUpgradeLevelDisplay(level, definition.maxLevel)
                const progressive = Number.isFinite(definition.maxLevel) && definition.maxLevel > 1

                return {
                    key: definition.key,
                    label: definition.label.replace(/ upgrade$/iu, "").replace(/^level\s+/iu, ""),
                    display: displayValue,
                    hint: definition.hint,
                    level,
                    maxLevel: definition.maxLevel,
                    showProgress: progressive
                }
            })
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
        },
        normalizedRole() {
            const role = this.user?.panelRole || this.user?.role
            if (typeof role === "string" && role.trim().length > 0) {
                return role.trim().toUpperCase()
            }
            return "USER"
        },
        quickShortcuts() {
            if (!this.isAuthenticated) {
                return []
            }
            return SHARED_SHORTCUTS.filter((shortcut) => this.isShortcutAllowed(shortcut))
        },
        canLeaveGlobally() {
            return ["MASTER", "ADMIN"].includes(this.normalizedRole)
        },
        shouldFocusGuildReach() {
            return this.$route?.query?.focus === "guilds"
        }
    },
    watch: {
        loginCode(code) {
            if (code) {
                this.handleOAuthCode(code, this.loginState)
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
        },
        shouldFocusGuildReach(newValue) {
            if (newValue) {
                this.scheduleGuildReachFocus()
            }
        },
        guildsLoading(isLoading) {
            if (!isLoading) {
                this.maybeFocusGuildReach()
            }
        }
    },
    created() {
        if (this.shouldFocusGuildReach) {
            this.scheduleGuildReachFocus()
        }
        if (this.loginCode) {
            this.handleOAuthCode(this.loginCode, this.loginState)
        } else if (this.isAuthenticated) {
            this.loadHomeData()
            this.startProfileAutoRefresh()
        }
        document.addEventListener("visibilitychange", this.handleVisibilityChange)
    },
    beforeUnmount() {
        this.stopProfileAutoRefresh()
        document.removeEventListener("visibilitychange", this.handleVisibilityChange)
    },
    methods: {
        onAuthenticated() {
            const fallbackRoute = consumePostLoginRoute(null)
            if (fallbackRoute && fallbackRoute !== this.$route.fullPath) {
                this.$router.replace(fallbackRoute).catch(() => {})
                return
            }
            this.clearAuthQuery()
        },
        clearAuthQuery() {
            const currentQuery = { ...(this.$route?.query || {}) }
            if (!currentQuery.code && !currentQuery.state) {
                return
            }
            delete currentQuery.code
            delete currentQuery.state
            this.$router.replace({ path: this.$route.path, query: currentQuery }).catch(() => {})
        },
        isShortcutAllowed(shortcut) {
            if (!shortcut) return false
            const allowedRoles = shortcut.roles
            if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
                return true
            }
            return allowedRoles.includes(this.normalizedRole)
        },
        handleShortcut(shortcut) {
            if (!shortcut || shortcut.disabled) return
            const handlerName = shortcut.handler
            if (handlerName && typeof this[handlerName] === "function") {
                this[handlerName](shortcut)
            }
        },
        async handleOAuthCode(code, state) {
            this.processing = true
            this.errorMessage = null
            try {
                await this.$store.dispatch("session/completeLogin", { code, state })
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
        async loadGuilds({ force = false } = {}) {
            this.guildsLoading = true
            try {
                const guilds = await api.getGuilds({ forceRefresh: force })
                const meta = guilds?.meta || {}
                this.guildsMeta = meta

                const normalizedAll = normalizeGuildList(guilds.all)
                const normalizedAddedRaw = normalizeGuildList(guilds.added)
                const normalizedAvailableRaw = normalizeGuildList(guilds.available)

                const userGuildIds = new Set(normalizedAll.map((guild) => guild.id))
                const sharedAdded = normalizedAddedRaw.filter((guild) => userGuildIds.has(guild.id))
                const mergedAdded = sharedAdded.length > 0 ? sharedAdded : normalizedAddedRaw
                const mergedAddedIds = new Set(mergedAdded.map((guild) => guild.id))

                const sanitizedAvailableRaw = normalizedAvailableRaw.filter((guild) => !mergedAddedIds.has(guild.id))
                const availableFromAll = normalizedAll.filter(
                    (guild) => !mergedAddedIds.has(guild.id) && sharedHasManageGuildPermission(guild)
                )
                const mergedAvailable = availableFromAll.length > 0 ? availableFromAll : sanitizedAvailableRaw

                this.guilds = {
                    all: normalizedAll,
                    added: mergedAdded,
                    available: mergedAvailable
                }

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
        async leaveGuild(guild) {
            if (!guild) return
            const guildId = typeof guild === "object" ? guild.id : guild
            if (!guildId) return
            const targetGuild = typeof guild === "object" ? guild : this.findGuildLocally(guildId)
            const hasServerPrivileges = targetGuild ? this.hasManageGuildPermission(targetGuild) : false
            if (!this.canLeaveGlobally && !hasServerPrivileges) {
                return
            }
            const csrfToken = this.$store.state.session.csrfToken
            if (!csrfToken) return

            const previousState = this.snapshotGuildCollections()
            const optimisticState = this.buildGuildCollectionsAfterLeave({
                previousState,
                guildId,
                targetGuild
            })
            this.guilds = optimisticState

            try {
                await api.leaveGuild({ csrfToken, guildId })
                this.pushToast("Chipsy has been removed from the selected server.")
                await this.loadGuilds({ force: true })
            } catch (error) {
                this.guilds = previousState
                // eslint-disable-next-line no-console
                console.error("Failed to leave guild", error)
                this.pushToast("Unable to remove Chipsy from that server.")
            }
        },
        pushToast(message) {
            if (!message) return
            window.dispatchEvent(new CustomEvent("chipsy-toast", { detail: { message } }))
        },
        pushGuildFocusToast() {
            if (this.$route?.query?.focus !== "guilds") {
                return
            }
            this.pushToast("Guild reach refreshed after your invite.")
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
        scrollToMarketing() {
            const target = document.getElementById("home-marketing")
            if (target) {
                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                })
            }
        },
        scheduleGuildReachFocus() {
            this.pendingGuildFocus = true
            this.$nextTick(() => {
                this.maybeFocusGuildReach()
            })
        },
        maybeFocusGuildReach() {
            if (!this.pendingGuildFocus) return
            if (this.guildsLoading || !this.isAuthenticated) return
            this.focusGuildReach()
        },
        focusGuildReach({ behavior = "smooth" } = {}) {
            const section = this.$refs.guildReachSection || document.getElementById("home-guild-reach")
            if (!section) return
            section.scrollIntoView({
                behavior,
                block: "start"
            })
            this.pendingGuildFocus = false
            this.pushGuildFocusToast()
            this.clearGuildFocusQuery()
        },
        clearGuildFocusQuery() {
            const query = { ...(this.$route?.query || {}) }
            if (!query.focus) {
                return
            }
            delete query.focus
            this.$router.replace({ path: this.$route.path, query }).catch(() => {})
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
        },
        hasManageGuildPermission(guild) {
            return sharedHasManageGuildPermission(guild)
        },
        snapshotGuildCollections() {
            const current = this.guilds || {}
            return {
                all: normalizeGuildList(current.all),
                added: normalizeGuildList(current.added),
                available: normalizeGuildList(current.available)
            }
        },
        buildGuildCollectionsAfterLeave({ previousState, guildId, targetGuild }) {
            const sanitizedAdded = previousState.added.filter((entry) => entry.id !== guildId)
            const sanitizedAvailable = previousState.available.filter((entry) => entry.id !== guildId)
            const shouldPromoteToAvailable = Boolean(targetGuild && this.hasManageGuildPermission(targetGuild))
            const nextAvailable = shouldPromoteToAvailable
                ? normalizeGuildList([...sanitizedAvailable, targetGuild])
                : sanitizedAvailable

            return {
                all: previousState.all,
                added: sanitizedAdded,
                available: nextAvailable
            }
        },
        findGuildLocally(guildId) {
            if (!guildId) return null
            const pool = [
                ...(this.guilds?.added || []),
                ...(this.guilds?.available || []),
                ...(this.guilds?.all || [])
            ]
            return pool.find((entry) => entry?.id === guildId) || null
        }
    }
}
</script>
