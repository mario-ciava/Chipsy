<template>
    <div class="page home">
        <header class="home__hero">
            <span v-if="isAuthenticated" class="home__badge">
                {{ roleLabel }} access
            </span>
            <h1 class="page__title">Chipsy Control Center</h1>
            <p class="page__subtitle home__subtitle">
                Monitor the bot, surface player stats, and drop Chipsy into Discord servers without touching a terminal.
            </p>
            <div class="home__cta" v-if="!isAuthenticated">
                <button class="button button--primary home__cta-button" @click="goToLogin" :disabled="processing">
                    <span v-if="processing">Redirecting…</span>
                    <span v-else>Sign in with Discord</span>
                </button>
            </div>
            <div class="home__cta home__cta--authed" v-else>
                <router-link
                    v-if="isAdmin"
                    to="/control_panel"
                    class="button button--primary home__cta-button"
                >
                    Open the panel
                </router-link>
                <router-link
                    v-if="canViewLogs"
                    to="/logs"
                    class="button button--secondary home__cta-button"
                >
                    View logs
                </router-link>
            </div>
        </header>

        <section v-if="isAuthenticated" class="home__dashboard">
            <div class="home__grid">
                <article class="card home__card home__profile-card">
                    <header class="home__card-header">
                        <div>
                            <h2 class="card__title">Your Chipsy profile</h2>
                            <p class="card__subtitle">
                                The same data exposed by the in-Discord <code>/profile</code> command.
                            </p>
                        </div>
                        <span class="home__tag">@{{ userName || "unknown" }}</span>
                    </header>

                    <div v-if="profileStats" class="home__metrics">
                        <div class="home__metric">
                            <span class="home__metric-label">Balance</span>
                            <span class="home__metric-value">{{ formattedBalance }}</span>
                        </div>
                        <div class="home__metric">
                            <span class="home__metric-label">Gold</span>
                            <span class="home__metric-value">{{ profileStats.gold || 0 }}</span>
                            <small class="home__metric-hint">Premium currency</small>
                        </div>
                        <div class="home__metric">
                            <span class="home__metric-label">Level</span>
                            <span class="home__metric-value">
                                Lv. {{ profileStats.level || 1 }}
                            </span>
                            <small class="home__metric-hint">
                                {{ formattedExp }}
                            </small>
                        </div>
                        <div class="home__metric">
                            <span class="home__metric-label">Last activity</span>
                            <span class="home__metric-value home__metric-value--sm">
                                {{ profileLastPlayed }}
                            </span>
                            <small class="home__metric-hint">Next reward {{ profileNextReward }}</small>
                        </div>
                    </div>
                    <p v-else class="home__placeholder">
                        We could not find Chipsy stats for this account yet. Play a game to create the profile.
                    </p>

                    <div class="home__profile-actions">
                        <button
                            class="button button--ghost"
                            type="button"
                            :disabled="profileRefreshing"
                            @click="refreshProfile"
                        >
                            <span v-if="profileRefreshing" class="button__spinner"></span>
                            <span v-else>Refresh info</span>
                        </button>
                    </div>
                </article>

                <article class="card home__card home__shortcuts">
                    <h2 class="card__title">Handy shortcuts</h2>
                    <ul class="home__shortcut-list">
                        <li>
                            <div>
                                <p class="home__shortcut-label">Invite Chipsy</p>
                                <p class="home__shortcut-desc">
                                    Open Discord's OAuth flow and pick one of your managed servers.
                                </p>
                            </div>
                            <button class="button button--secondary" type="button" @click="openGenericInvite">
                                Invite
                            </button>
                        </li>
                        <li v-if="isAdmin">
                            <div>
                                <p class="home__shortcut-label">Control panel</p>
                                <p class="home__shortcut-desc">
                                    Toggle the bot, manage access lists, and run quick actions.
                                </p>
                            </div>
                            <router-link to="/control_panel" class="button button--primary">
                                Open
                            </router-link>
                        </li>
                        <li v-if="canViewLogs">
                            <div>
                                <p class="home__shortcut-label">Live logs</p>
                                <p class="home__shortcut-desc">
                                    Monitor command usage and debug output without SSH.
                                </p>
                            </div>
                            <router-link to="/logs" class="button button--ghost">
                                Console
                            </router-link>
                        </li>
                    </ul>
                </article>
            </div>

            <section class="home__section home__section--guilds">
                <div class="home__section-header">
                    <div>
                        <h3>Servers you can manage</h3>
                        <p>
                            Active and invite-ready guilds pulled straight from Discord. Admins can remove Chipsy from any active server.
                        </p>
                    </div>
                    <span class="home__section-meta">
                        {{ guilds.added.length }} active · {{ guilds.available.length }} invite-ready
                    </span>
                </div>
                <div v-if="guildNotice" class="home__section-notice">
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

        <section v-else class="page__section home__section home__section--public">
            <div class="card card--highlight home__card">
                <h2 class="card__title">Sign in with Discord</h2>
                <p class="card__body">
                    Use your account to unlock the control panel. Only approved admins can enable or suspend Chipsy and review community stats.
                </p>
                <div class="home__cta">
                    <button class="button button--primary home__cta-button" @click="goToLogin" :disabled="processing">
                        <span v-if="processing">Redirecting…</span>
                        <span v-else>Authenticate</span>
                    </button>
                </div>
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
        </section>

        <div v-if="processing" class="page__status home__status">
            Validating your access…
        </div>

        <transition name="fade">
            <div v-if="errorMessage" class="page__error">
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

<style scoped>
.home {
    display: flex;
    flex-direction: column;
    gap: 32px;
    padding: clamp(48px, 5vw, 72px) clamp(16px, 4vw, 40px);
}

.home__hero {
    text-align: center;
    max-width: 780px;
    margin: 0 auto 24px;
}

.home__badge {
    display: inline-flex;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 0.85rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 12px;
    border: 1px solid rgba(148, 163, 184, 0.3);
    background: rgba(148, 163, 184, 0.12);
    color: var(--fg-secondary);
}

.home__cta {
    margin-top: 24px;
    display: flex;
    justify-content: center;
    gap: 16px;
    flex-wrap: wrap;
}

.home__cta--authed {
    margin-top: 16px;
}

.home__cta-button {
    min-width: 160px;
}

.home__dashboard {
    display: flex;
    flex-direction: column;
    gap: 28px;
}

.home__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 20px;
}

.home__card {
    height: 100%;
    gap: 18px;
}

.home__card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
}

.home__tag {
    padding: 6px 12px;
    border-radius: var(--radius-full, 999px);
    background: rgba(124, 58, 237, 0.18);
    border: 1px solid rgba(124, 58, 237, 0.35);
    font-size: 0.9rem;
    font-weight: 600;
}

.home__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;
}

.home__metric {
    padding: 12px 14px;
    border-radius: var(--radius-md);
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.home__metric-label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--fg-muted);
}

.home__metric-value {
    font-size: 1.35rem;
    font-weight: 600;
}

.home__metric-value--sm {
    font-size: 1rem;
    word-break: break-word;
}

.home__metric-hint {
    margin: 0;
    color: var(--fg-muted);
    font-size: 0.8rem;
}

.home__placeholder {
    margin: 0;
    padding: 14px;
    border-radius: var(--radius-md);
    background: rgba(248, 113, 113, 0.08);
    border: 1px dashed rgba(248, 113, 113, 0.35);
    color: #fecaca;
}

.home__profile-actions {
    display: flex;
    justify-content: flex-end;
}

.home__shortcut-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.home__shortcut-list li {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.home__shortcut-list li:last-child {
    border-bottom: none;
}

.home__shortcut-label {
    margin: 0;
    font-weight: 600;
}

.home__shortcut-desc {
    margin: 4px 0 0;
    color: var(--fg-muted);
    font-size: 0.9rem;
}

.home__section--guilds {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.home__section-header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.home__section-header h3 {
    margin: 0;
    font-size: 1.2rem;
}

.home__section-header p {
    margin: 4px 0 0;
    color: var(--fg-muted);
}

.home__section-meta {
    align-self: flex-start;
    padding: 6px 12px;
    border-radius: var(--radius-full, 999px);
    border: 1px solid rgba(148, 163, 184, 0.2);
    background: rgba(15, 23, 42, 0.4);
    font-weight: 600;
}

.home__section-notice {
    padding: 10px 14px;
    border-radius: 12px;
    background: rgba(252, 211, 77, 0.15);
    border: 1px solid rgba(252, 211, 77, 0.35);
    color: #fef3c7;
    font-weight: 500;
}

.home__section--public {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 20px;
}

.home__features {
    gap: 16px;
}

.features-list {
    margin: 0;
    padding-left: 18px;
    color: var(--fg-muted);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.home__status {
    text-align: center;
    margin-top: 12px;
    color: var(--fg-muted);
}

@media (max-width: 640px) {
    .home {
        padding: 32px 16px 64px;
    }

    .home__metric-value {
        font-size: 1.2rem;
    }

    .home__shortcut-list li {
        flex-direction: column;
        align-items: flex-start;
    }

    .home__section-meta {
        width: 100%;
        text-align: center;
    }
}
</style>
