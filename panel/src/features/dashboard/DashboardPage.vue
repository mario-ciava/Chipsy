<template>
    <div class="chip-section">
        <header class="chip-card chip-card--accent">
            <div class="chip-card__header">
                <div class="chip-stack">
                    <div class="flex items-center gap-2">
                        <span class="chip-eyebrow">Control panel</span>
                        <span
                            class="chip-info-dot"
                            role="img"
                            tabindex="0"
                            aria-label="Realtime telemetry"
                            :data-tooltip="`Dashboard data auto-refreshes every ${Math.round(statusRefreshInterval / 1000)}s.`"
                        ></span>
                    </div>
                    <div class="flex flex-wrap items-center gap-3">
                        <h1 class="chip-heading">Orchestrate the Chipsy fleet</h1>
                    </div>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Stay on top of toggles, authorisations, and remote controls without bouncing between views.
                    </p>
                </div>
                <div v-if="user" class="flex flex-col items-end gap-2 text-right">
                    <span class="chip-label">Access level</span>
                    <span class="chip-pill chip-pill-info">{{ roleLabel }}</span>
                </div>
            </div>
        </header>

        <transition name="fade">
            <div v-if="flashMessage" :class="flashNoticeClass">
                {{ flashMessage.message }}
            </div>
        </transition>

        <section class="chip-grid chip-grid--split">
            <div class="chip-stack">
                <BotStatusCard
                    :status="botStatus"
                    :loading="botLoading"
                    :cooldown-active="cooldown.active"
                    :cooldown-target="cooldown.target"
                    :cooldown-remaining="cooldown.remaining"
                    :cooldown-duration="cooldownDuration"
                    :toggle-hold-duration="holdDuration"
                    :kill-loading="botKillPending"
                    @toggle="toggleBot"
                    @kill="handleKillRequest"
                />
                <AccessPolicyCard
                    :policy="accessPolicy"
                    :loading="accessPolicyLoading"
                    :saving="policySaving"
                    @toggle="handlePolicyToggle"
                />
            </div>
            <aside class="chip-stack h-full">
                <RemoteActions
                    :actions="actions"
                    @action-success="handleActionSuccess"
                    @action-error="handleActionError"
                />
            </aside>
        </section>
        <UserTable
            :users="users"
            :pagination="pagination"
            :loading="usersLoading"
            :filters="userFilters"
            @search="handleSearch"
            @change-page="handlePageChange"
            @refresh="refreshUsers"
            @open-details="openUserDetails"
        />

        <div v-if="errorMessage" class="chip-notice chip-notice-error">
            {{ errorMessage }}
        </div>
    </div>
</template>

<script>
import { mapActions, mapGetters, mapState } from "vuex"
import { getRoleLabel } from "../../constants/roles"
import BotStatusCard from "./components/BotStatusCard.vue"
import RemoteActions from "./components/RemoteActions.vue"
import UserTable from "./components/UserTable.vue"
import AccessPolicyCard from "./components/AccessPolicyCard.vue"
import api from "../../services/api"

export default {
    name: "DashboardPage",
    components: {
        BotStatusCard,
        RemoteActions,
        UserTable,
        AccessPolicyCard
    },
    data() {
        return {
            guilds: {
                added: [],
                available: []
            },
            guildsMeta: null,
            actions: [],
            errorMessage: null,
            statusInterval: null,
            flashMessage: null,
            flashTimeout: null,
            guildsLoading: false,
            guildRateLimitedNotified: false,
            guildCooldownNotified: false,
            cooldown: {
                active: false,
                target: null,
                remaining: 0
            },
            cooldownInterval: null,
            cooldownStart: null,
            lastStatusEnabled: null,
            lastStatusUpdatedAt: null,
            botKillPending: false,
            policySaving: false
        }
    },
    computed: {
        ...mapGetters("session", ["user", "isAuthenticated", "panelConfig"]),
        ...mapState("session", {
            csrfToken: (state) => state.csrfToken
        }),
        ...mapState("bot", {
            botStatus: (state) => state.status || {},
            botLoading: (state) => state.loading
        }),
        ...mapState("users", {
            users: (state) => state.items,
            pagination: (state) => state.pagination,
            usersLoading: (state) => state.loading,
            userFilters: (state) => state.filters,
            accessPolicy: (state) => state.policy,
            accessPolicyLoading: (state) => state.policyLoading
        }),
        roleLabel() {
            return getRoleLabel(this.user?.role)
        },
        flashNoticeClass() {
            if (!this.flashMessage) return ""
            const variants = {
                success: "chip-notice-success",
                warning: "chip-notice-warning",
                error: "chip-notice-error",
                info: "chip-notice-info"
            }
            return variants[this.flashMessage.type] || variants.info
        },
        cooldownDuration() {
            return this.panelConfig?.toggles?.cooldownMs || 15000
        },
        holdDuration() {
            return this.panelConfig?.toggles?.holdDurationMs || 3000
        },
        statusRefreshInterval() {
            return this.panelConfig?.status?.refreshIntervalMs || 30000
        },
        guildJoinDelay() {
            return this.panelConfig?.guilds?.waitForJoin?.pollDelayMs || 1500
        },
        guildJoinAttemptsWithTarget() {
            return this.panelConfig?.guilds?.waitForJoin?.maxAttemptsWithTarget || 5
        },
        guildJoinAttemptsWithoutTarget() {
            return this.panelConfig?.guilds?.waitForJoin?.maxAttemptsWithoutTarget || 3
        }
    },
    watch: {
        botStatus: {
            deep: true,
            handler(newStatus) {
                if (!newStatus || typeof newStatus.enabled !== "boolean") return
                const updatedAt = newStatus.updatedAt || null
                if (this.lastStatusEnabled === null) {
                    this.lastStatusEnabled = newStatus.enabled
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("info", `Initial status: bot ${newStatus.enabled ? "online" : "offline"}.`)
                    return
                }
                const statusChanged = this.lastStatusEnabled !== newStatus.enabled
                const timestampChanged = updatedAt && this.lastStatusUpdatedAt !== updatedAt
                if (statusChanged) {
                    this.lastStatusEnabled = newStatus.enabled
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("success", `Bot is now ${newStatus.enabled ? "online" : "offline"}.`)
                } else if (timestampChanged) {
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("debug", "Status refresh completed with no changes.")
                }
            }
        }
    },
    async created() {
        if (!this.isAuthenticated) {
            this.$router.replace({ name: "Login" })
            return
        }
        this.pushLog("system", "Dashboard loaded. Kicking off data sync…")
        await this.initialize()
        await this.handleInviteRedirect()
    },
    beforeDestroy() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval)
            this.statusInterval = null
        }
        if (this.flashTimeout) {
            clearTimeout(this.flashTimeout)
            this.flashTimeout = null
        }
        this.cancelCooldown({ silent: true })
    },
    methods: {
        setFlash(message, type = "info") {
            if (this.flashTimeout) {
                clearTimeout(this.flashTimeout)
                this.flashTimeout = null
            }
            if (!message) {
                this.flashMessage = null
                return
            }
            this.flashMessage = { message, type }
            this.flashTimeout = setTimeout(() => {
                this.flashMessage = null
                this.flashTimeout = null
            }, 5000)
        },
        async waitForGuildJoin(guildId) {
            if (guildId && this.guilds.added.some((guild) => guild.id === guildId)) {
                return true
            }
            const maxAttempts = guildId ? this.guildJoinAttemptsWithTarget : this.guildJoinAttemptsWithoutTarget
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const shouldForce = attempt === 0 && !this.guildsMeta?.cooldown
                await this.loadGuilds({ force: shouldForce })
                if (!guildId) {
                    return true
                }
                if (this.guilds.added.some((guild) => guild.id === guildId)) {
                    return true
                }
                await new Promise((resolve) => setTimeout(resolve, this.guildJoinDelay))
            }
            return false
        },
        async handleInviteRedirect() {
            if (this.$route.query.state !== "controlPanelInvite") return
            const guildId = this.$route.query.guild_id || null
            const code = this.$route.query.code || null
            const csrfToken = this.$store.state.session.csrfToken

            if (code) {
                if (!csrfToken) {
                    this.setFlash("Invalid session. Log in again and redo the invite.", "warning")
                    this.$router.replace({ path: "/control_panel" }).catch(() => {})
                    return
                }
                try {
                    await api.completeInvite({ csrfToken, code, guildId })
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error("Failed to finalize invite", error)
                    this.setFlash("Unable to complete the invite. Try again later.", "warning")
                    this.$router.replace({ path: "/control_panel" }).catch(() => {})
                    return
                }
            }

            const joined = await this.waitForGuildJoin(guildId)
            if (joined) {
                this.$store.dispatch("bot/fetchStatus").catch(() => null)
                this.setFlash("Chipsy joined the selected server.", "success")
            } else if (guildId) {
                this.setFlash("Invite completed. Discord is still processing the bot join—try again in a few seconds.", "warning")
            } else {
                this.setFlash("Invite completed. Refresh the list to confirm active servers.")
            }
            this.$router.replace({ path: "/control_panel" }).catch(() => {})
        },
        async initialize() {
            this.errorMessage = null
            try {
                await this.$store.dispatch("bot/fetchStatus")
            } catch (error) {
                this.errorMessage = "Unable to fetch the bot status."
                // eslint-disable-next-line no-console
                console.error(error)
                this.pushLog("error", "Bot status fetch failed.")
            }

            await Promise.all([
                this.loadGuilds(),
                this.loadActions(),
                this.refreshUsers(),
                this.$store.dispatch("users/fetchPolicy").catch(() => null)
            ])

            if (this.statusInterval) {
                clearInterval(this.statusInterval)
            }
            this.statusInterval = setInterval(() => {
                this.$store.dispatch("bot/fetchStatus").catch(() => {
                    this.pushLog("warning", "Automatic status refresh failed.")
                })
            }, this.statusRefreshInterval)
        },
        async loadGuilds({ force = false } = {}) {
            if (!this.isAuthenticated) return
            this.guildsLoading = true

            try {
                const guilds = await api.getGuilds({ forceRefresh: force })
                const meta = guilds?.meta || {}
                this.guildsMeta = meta

                const added = Array.isArray(guilds.added) ? guilds.added : []
                const availableRaw = Array.isArray(guilds.available) ? guilds.available : []
                const addedIds = new Set(added.map((guild) => guild.id))
                const available = availableRaw.filter((guild) => !addedIds.has(guild.id))

                this.guilds = {
                    added,
                    available
                }

                const wasRateLimited = Boolean(meta.rateLimited)
                if (wasRateLimited && !this.guildRateLimitedNotified) {
                    this.setFlash("Discord is throttling guild updates. Showing cached data.", "warning")
                    this.guildRateLimitedNotified = true
                    this.pushLog("warning", "Guild refresh limited by Discord; cache served.")
                } else if (!wasRateLimited) {
                    this.guildRateLimitedNotified = false
                }

                const wasCooldown = Boolean(meta.cooldown)
                if (wasCooldown && force && !this.guildCooldownNotified) {
                    this.setFlash("Guild refresh cooling down. Serving cached data for a moment.", "warning")
                    this.guildCooldownNotified = true
                    this.pushLog("info", "Guild refresh skipped due to cooldown; waiting before next live call.")
                } else if (!wasCooldown) {
                    this.guildCooldownNotified = false
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load guilds", error)
                this.pushLog("warning", "Unable to refresh the server list.")
                const warningMessage = error?.response?.data?.message || error?.message
                if (warningMessage) {
                    this.setFlash(warningMessage.replace(/^\d{3}:\s*/, ""), "warning")
                }
            } finally {
                this.guildsLoading = false
            }
        },
        async loadActions() {
            if (!this.isAuthenticated) return
            try {
                const response = await api.getAdminActions()
                this.actions = response.actions || []
                this.pushLog("info", `Remote actions available: ${this.actions.length}.`)
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load remote actions", error)
                this.pushLog("warning", "Unable to refresh remote actions.")
            }
        },
        async handlePolicyToggle(enforceWhitelist) {
            if (this.policySaving) return
            if (!this.csrfToken) {
                this.setFlash("Missing CSRF token. Reload the page and try again.", "warning")
                return
            }
            this.policySaving = true
            const targetState = enforceWhitelist ? "enabled" : "disabled"
            try {
                await this.$store.dispatch("users/updatePolicy", {
                    csrfToken: this.csrfToken,
                    enforceWhitelist
                })
                const message = enforceWhitelist
                    ? "Whitelist enforcement enabled. Only whitelisted users (plus admins) can use Chipsy."
                    : "Whitelist enforcement disabled. Any non-blacklisted user can use Chipsy."
                this.setFlash(message, "success")
                this.pushLog("info", `Whitelist enforcement ${targetState}.`)
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to update whitelist policy", error)
                const message = error?.response?.data?.message || "Unable to update the whitelist setting."
                this.setFlash(message, "warning")
                this.pushLog("error", "Whitelist toggle failed.")
            } finally {
                this.policySaving = false
            }
        },
        async toggleBot(enabled) {
            const target = enabled ? "enable" : "disable"
            this.pushLog("info", `Request to ${enabled ? "enable" : "disable"} sent.`)
            this.startCooldown(target)
            try {
                await this.$store.dispatch("bot/updateEnabled", enabled)
                this.pushLog("success", "Status updated successfully by the server.")
            } catch (error) {
                this.cancelCooldown()
                if (error.code === 409) {
                    this.setFlash(error.message, "warning")
                    this.pushLog("warning", "Operation already in progress: nothing changed.")
                } else {
                    this.setFlash("Unable to update the bot status.", "warning")
                    this.pushLog("error", "Toggle failed: check the server logs for details.")
                }
                // eslint-disable-next-line no-console
                console.error("Toggle bot failed", error)
            }
        },
        startCooldown(target) {
            this.cancelCooldown({ silent: true })
            this.cooldown.target = target
            this.cooldown.active = true
            this.cooldown.remaining = this.cooldownDuration
            this.cooldownStart = Date.now()
            const seconds = Math.max(1, Math.round(this.cooldownDuration / 1000))
            this.pushLog("system", `${seconds}-second safety cooldown activated.`)
            this.cooldownInterval = setInterval(() => {
                const elapsed = Date.now() - this.cooldownStart
                const remaining = Math.max(0, this.cooldownDuration - elapsed)
                this.cooldown.remaining = remaining
                if (remaining <= 0) {
                    this.finishCooldown()
                }
            }, 100)
        },
        finishCooldown({ silent = false } = {}) {
            if (this.cooldownInterval) {
                clearInterval(this.cooldownInterval)
                this.cooldownInterval = null
            }
            this.cooldown.active = false
            this.cooldown.remaining = 0
            this.cooldown.target = null
            this.cooldownStart = null
            if (!silent) {
                this.pushLog("system", "Cooldown finished: controls unlocked again.")
            }
        },
        cancelCooldown({ silent = false } = {}) {
            if (!this.cooldown.active && !this.cooldownInterval) {
                return
            }
            this.finishCooldown({ silent })
        },
        async handleSearch(value) {
            try {
                if (value && typeof value === "object") {
                    await this.$store.dispatch("users/fetchUsers", {
                        page: 1,
                        filters: value
                    })
                } else {
                    const searchValue = typeof value === "string" ? value.trim() : ""
                    await this.$store.dispatch("users/fetchUsers", {
                        page: 1,
                        search: searchValue
                    })
                }
            } catch (error) {
                this.errorMessage = "Error while searching users."
                // eslint-disable-next-line no-console
                console.error("User search failed", error)
            }
        },
        async handlePageChange(page) {
            try {
                await this.$store.dispatch("users/fetchUsers", {
                    page
                })
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Pagination change failed", error)
            }
        },
        async refreshUsers() {
            this.errorMessage = null
            try {
                await this.$store.dispatch("users/refresh")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Refresh users failed", error)
                this.errorMessage = "Unable to refresh the user list."
                this.pushLog("warning", "User list refresh failed; showing cached data.")
            }
        },
        async leaveGuild(id) {
            try {
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication context")
                }
                await api.leaveGuild({ csrfToken, guildId: id })
                await this.loadGuilds({ force: true })
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to leave guild", error)
                this.errorMessage = "Unable to remove the bot from the selected server."
            }
        },
        openUserDetails(id) {
            this.$router.push({ name: "UserDetail", params: { id } })
        },
        handleActionSuccess(message) {
            this.setFlash(message, "success")
            this.pushLog("success", message)
        },
        handleActionError(message) {
            this.setFlash(message, "warning")
            this.pushLog("error", message)
        },
        async handleKillRequest(payload) {
            const target = payload?.target || "bot"
            if (target === "mysql") {
                const message = "Killing the MySQL service is not exposed in this panel."
                this.setFlash(message, "warning")
                this.pushLog("warning", "Panel does not support killing MySQL; ignoring request.")
                return
            }
            await this.requestKillBot()
        },
        async requestKillBot() {
            if (this.botKillPending) return

            const csrfToken = this.$store.state.session.csrfToken
            if (!csrfToken) {
                this.handleActionError("Unable to terminate the bot process.")
                return
            }

            this.botKillPending = true
            this.pushLog("info", "'Kill bot' command requested.")

            try {
                await api.killBot({ csrfToken })
                this.handleActionSuccess("The bot process will be terminated shortly.")
                this.pushLog("success", "'Kill bot' command sent to the server.")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to kill bot process", error)
                this.handleActionError("Unable to terminate the bot process.")
            } finally {
                this.botKillPending = false
            }
        },
        ...mapActions("logs", { addLogEntry: "add" }),
        pushLog(level, message) {
            if (!message) return
            this.addLogEntry({ level, message })
        }
    }
}
</script>
