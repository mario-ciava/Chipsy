<template>
    <div class="flex flex-col gap-8">
        <section class="chip-card space-y-6">
            <header class="flex flex-wrap items-start justify-between gap-4">
                <div class="space-y-3">
                    <h1 class="text-3xl font-semibold text-white">{{ userDisplayName }}</h1>
                    <p class="text-sm text-slate-300">Overview of the stored bankroll data and this account&apos;s panel privileges.</p>
                    <div class="flex flex-wrap items-center gap-2 text-sm text-slate-400">
                        <span class="chip-label">Discord ID</span>
                        <code class="font-mono text-white">{{ userId }}</code>
                        <button
                            type="button"
                            class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                            @click="copyUserId"
                            aria-label="Copy Discord ID"
                        >
                            Copy
                        </button>
                    </div>
                    <p v-if="copyStatus" class="text-xs text-slate-400">{{ copyStatus }}</p>
                </div>
                <router-link to="/control_panel" class="chip-btn chip-btn-ghost">
                    ← Back to panel
                </router-link>
            </header>

            <div v-if="loading" class="chip-empty">Loading data…</div>
            <div v-else-if="error" class="chip-notice chip-notice-warning">{{ error }}</div>
            <div v-else class="space-y-6">
                <div v-if="statusBanner" :class="statusBannerClass">
                    {{ statusBanner.message }}
                </div>
                <div class="grid gap-4 lg:grid-cols-3">
                    <article class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                        <h2 class="chip-label">Balances</h2>
                        <dl class="space-y-2 text-sm text-slate-300">
                            <div class="flex justify-between"><dt>Balance</dt><dd class="font-semibold text-white">{{ formatted.money }}</dd></div>
                            <div class="flex justify-between"><dt>Gold</dt><dd class="font-semibold text-white">{{ formatted.gold }}</dd></div>
                            <div class="flex justify-between"><dt>Biggest win</dt><dd class="font-semibold text-white">{{ formatted.biggestWon }}</dd></div>
                            <div class="flex justify-between"><dt>Biggest bet</dt><dd class="font-semibold text-white">{{ formatted.biggestBet }}</dd></div>
                        </dl>
                    </article>
                    <article class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                        <h2 class="chip-label">Progression</h2>
                        <dl class="space-y-2 text-sm text-slate-300">
                            <div class="flex justify-between"><dt>Level</dt><dd class="font-semibold text-white">{{ formatted.level }}</dd></div>
                            <div class="flex justify-between"><dt>Exp</dt><dd class="font-semibold text-white">{{ formatted.exp }}</dd></div>
                            <div class="flex justify-between"><dt>Win rate</dt><dd class="font-semibold text-white">{{ formatted.winRate }}</dd></div>
                            <div class="flex justify-between"><dt>Last activity</dt><dd class="font-semibold text-white">{{ formatted.lastPlayed }}</dd></div>
                        </dl>
                    </article>
                    <article class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                        <h2 class="chip-label">Panel access</h2>
                        <dl class="space-y-2 text-sm text-slate-300">
                            <div class="flex justify-between"><dt>Role</dt><dd class="font-semibold text-white">{{ roleLabel }}</dd></div>
                            <div class="flex justify-between"><dt>Whitelist</dt><dd class="font-semibold text-white">{{ user.access?.isWhitelisted ? 'Enabled' : 'Disabled' }}</dd></div>
                            <div class="flex justify-between"><dt>Blacklist</dt><dd class="font-semibold text-white">{{ user.access?.isBlacklisted ? 'Enabled' : 'Disabled' }}</dd></div>
                            <div class="flex justify-between"><dt>Last update</dt><dd class="font-semibold text-white">{{ formatted.updatedAccess || 'Not available' }}</dd></div>
                        </dl>
                    </article>
                </div>
            </div>
        </section>

        <section class="grid gap-6 lg:grid-cols-2">
            <article class="chip-card space-y-4">
                <h3 class="chip-card__title">Role management</h3>
                <p class="chip-card__subtitle">
                    Assign a new role to define which areas of the control panel this account can reach.
                </p>
                <label class="chip-label">Role</label>
                <select
                    v-model="roleForm.pending"
                    class="chip-select"
                    :disabled="!canEditRole || roleForm.saving"
                >
                    <option v-for="option in availableRoleOptions" :key="option.value" :value="option.value">
                        {{ option.label }}
                    </option>
                </select>
                <p class="text-xs text-slate-400">{{ roleDescription }}</p>
                <div class="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        class="chip-btn chip-btn-secondary"
                        :disabled="!roleDirty || !canEditRole || roleForm.saving"
                        @click="saveRole"
                    >
                        <span v-if="roleForm.saving" class="chip-spinner"></span>
                        <span v-else>Save role</span>
                    </button>
                    <span v-if="roleForm.error" class="text-xs text-rose-200">{{ roleForm.error }}</span>
                    <span v-else-if="roleForm.success" class="text-xs text-emerald-200">{{ roleForm.success }}</span>
                </div>
            </article>

            <article class="chip-card space-y-4">
                <h3 class="chip-card__title">Access lists</h3>
                <p class="chip-card__subtitle">
                    Blacklist permanently blocks the bot for this account. Whitelist grants access while whitelist mode is active (currently
                    <strong>{{ whitelistActive ? 'active' : 'inactive' }}</strong>).
                </p>
                <div class="space-y-3">
                    <label class="flex items-center gap-3 text-sm text-slate-200">
                        <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-white/20 bg-slate-900"
                            v-model="listsForm.pendingWhitelist"
                            :disabled="!canEditLists || listsForm.saving"
                        >
                        <span>Whitelist</span>
                    </label>
                    <label class="flex items-center gap-3 text-sm text-slate-200">
                        <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-white/20 bg-slate-900"
                            v-model="listsForm.pendingBlacklist"
                            :disabled="!canEditLists || listsForm.saving"
                        >
                        <span>Blacklist</span>
                    </label>
                    <p v-if="!canEditLists" class="text-xs text-slate-400">
                        Only admins can manage whitelist/blacklist entries.
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        class="chip-btn chip-btn-ghost"
                        :disabled="!listsDirty || !canEditLists || listsForm.saving"
                        @click="saveLists"
                    >
                        <span v-if="listsForm.saving" class="chip-spinner"></span>
                        <span v-else>Save lists</span>
                    </button>
                    <span v-if="listsForm.error" class="text-xs text-rose-200">{{ listsForm.error }}</span>
                    <span v-else-if="listsForm.success" class="text-xs text-emerald-200">{{ listsForm.success }}</span>
                </div>
            </article>
        </section>
    </div>
</template>

<script>
import { mapGetters, mapState } from "vuex"
import api from "../../services/api"
import { ROLE_OPTIONS, getRoleLabel, getRoleDescription } from "../../constants/roles"
import {
    formatCurrency,
    formatPercentage,
    formatExpRange,
    formatDetailedDateTime,
    formatFriendlyDateTime
} from "../../utils/formatters"
import { showToast } from "../../utils/toast"
import { copyToClipboard } from "../../utils/clipboard"

export default {
    name: "UserDetailPage",
    data() {
        return {
            loading: true,
            error: null,
            user: null,
            roleForm: {
                current: null,
                pending: null,
                saving: false,
                error: null,
                success: null
            },
            listsForm: {
                pendingWhitelist: false,
                pendingBlacklist: false,
                currentWhitelist: false,
                currentBlacklist: false,
                saving: false,
                error: null,
                success: null
            },
            copyStatus: null,
            copyStatusTimeout: null
        }
    },
    computed: {
        ...mapState("session", {
            csrfToken: (state) => state.csrfToken
        }),
        ...mapGetters("session", {
            canManageRoles: "canManageRoles",
            canManageLists: "canManageLists",
            canAssignAdmin: "canAssignAdmin",
            canAssignModerator: "canAssignModerator"
        }),
        ...mapState("users", {
            accessPolicy: (state) => state.policy
        }),
        userId() {
            return this.$route.params.id
        },
        userDisplayName() {
            if (!this.user) return "User profile"
            return this.user.username || this.user.id || "User profile"
        },
        roleLabel() {
            return getRoleLabel(this.user?.panelRole || this.user?.access?.role)
        },
        roleDescription() {
            return getRoleDescription(this.roleForm.pending || this.roleForm.current)
        },
        formatted() {
            const user = this.user || {}
            return {
                money: formatCurrency(user.money),
                gold: Number.isFinite(Number(user.gold)) ? Number(user.gold).toLocaleString() : "0",
                biggestWon: formatCurrency(user.biggest_won),
                biggestBet: formatCurrency(user.biggest_bet),
                level: user.level !== undefined ? user.level : 0,
                exp: formatExpRange(user.current_exp, user.required_exp),
                winRate: formatPercentage(user.winRate),
                lastPlayed: formatFriendlyDateTime(user.last_played),
                updatedAccess: formatDetailedDateTime(user.access?.updatedAt)
            }
        },
        isMasterTarget() {
            return (this.user?.access?.role || this.user?.panelRole) === "MASTER"
        },
        whitelistActive() {
            return Boolean(this.accessPolicy?.enforceWhitelist)
        },
        canEditRole() {
            return this.canManageRoles && !this.isMasterTarget
        },
        canEditLists() {
            return this.canManageLists && !this.isMasterTarget
        },
        availableRoleOptions() {
            if (this.isMasterTarget) {
                return [{ value: "MASTER", label: getRoleLabel("MASTER") }]
            }
            const currentRole = this.roleForm.current
            return ROLE_OPTIONS.filter((option) => {
                if (option.value === currentRole) {
                    return true
                }
                if (option.value === "MASTER") return false
                if (option.value === "ADMIN") {
                    return this.canAssignAdmin
                }
                if (option.value === "MODERATOR") {
                    return this.canAssignModerator
                }
                return true
            })
        },
        statusBanner() {
            if (!this.user?.access) return null
            if (this.user.access.isBlacklisted) {
                return {
                    tone: "danger",
                    message: "This account is blacklisted and Chipsy will ignore all of its commands."
                }
            }
            if (this.user.access.isWhitelisted) {
                if (this.whitelistActive) {
                    return {
                        tone: "info",
                        message: "Whitelist enforcement is active and this account is allowed to use Chipsy."
                    }
                }
                return {
                    tone: "info",
                    message: "This account is ready for whitelist mode when it becomes active."
                }
            }
            return null
        },
        statusBannerClass() {
            if (!this.statusBanner) return ""
            const tone = this.statusBanner.tone
            if (tone === "danger") return "chip-notice chip-notice-error"
            return "chip-notice chip-notice-info"
        },
        roleDirty() {
            return this.roleForm.pending && this.roleForm.pending !== this.roleForm.current
        },
        listsDirty() {
            return (
                this.listsForm.pendingWhitelist !== this.listsForm.currentWhitelist
                || this.listsForm.pendingBlacklist !== this.listsForm.currentBlacklist
            )
        }
    },
    async created() {
        if (!this.accessPolicy) {
            this.$store.dispatch("users/fetchPolicy").catch(() => null)
        }
        await this.loadUser()
    },
    beforeDestroy() {
        if (this.copyStatusTimeout) {
            clearTimeout(this.copyStatusTimeout)
            this.copyStatusTimeout = null
        }
    },
    watch: {
        "roleForm.pending"() {
            this.roleForm.error = null
            this.roleForm.success = null
        },
        "listsForm.pendingWhitelist"() {
            this.listsForm.error = null
            this.listsForm.success = null
        },
        "listsForm.pendingBlacklist"() {
            this.listsForm.error = null
            this.listsForm.success = null
        }
    },
    methods: {
        async loadUser() {
            this.loading = true
            this.error = null
            try {
                const data = await api.getUserById({ id: this.userId })
                this.user = data
                this.syncForms()
            } catch (error) {
                this.error = "Unable to fetch that user's details."
            } finally {
                this.loading = false
            }
        },
        syncForms() {
            if (!this.user) return
            const role = this.user.panelRole || this.user.access?.role || "USER"
            this.roleForm.current = role
            this.roleForm.pending = role
            const flags = this.user.access || {}
            this.listsForm.currentWhitelist = Boolean(flags.isWhitelisted)
            this.listsForm.currentBlacklist = Boolean(flags.isBlacklisted)
            this.listsForm.pendingWhitelist = this.listsForm.currentWhitelist
            this.listsForm.pendingBlacklist = this.listsForm.currentBlacklist
        },
        async saveRole() {
            if (!this.canEditRole || !this.roleDirty) return
            if (!this.csrfToken) {
                this.roleForm.error = "Missing CSRF token."
                return
            }
            this.roleForm.saving = true
            this.roleForm.error = null
            this.roleForm.success = null
            try {
                const response = await api.updateUserRole({
                    csrfToken: this.csrfToken,
                    userId: this.userId,
                    role: this.roleForm.pending
                })
                this.user.panelRole = response.role
                this.user.access = {
                    ...(this.user.access || {}),
                    ...(response.access || {})
                }
                this.syncForms()
                this.roleForm.success = "Role updated successfully."
            } catch (error) {
                this.roleForm.error = error?.response?.data?.message || "Unable to update the role."
            } finally {
                this.roleForm.saving = false
            }
        },
        async saveLists() {
            if (!this.canEditLists || !this.listsDirty) return
            if (!this.csrfToken) {
                this.listsForm.error = "Missing CSRF token."
                return
            }
            this.listsForm.saving = true
            this.listsForm.error = null
            this.listsForm.success = null
            try {
                const response = await api.updateUserLists({
                    csrfToken: this.csrfToken,
                    userId: this.userId,
                    isBlacklisted: this.listsForm.pendingBlacklist,
                    isWhitelisted: this.listsForm.pendingWhitelist
                })
                this.user.access = {
                    ...(this.user.access || {}),
                    ...response
                }
                this.syncForms()
                this.listsForm.success = "Lists updated successfully."
            } catch (error) {
                this.listsForm.error = error?.response?.data?.message || "Unable to update the lists."
            } finally {
                this.listsForm.saving = false
            }
        },
        async copyUserId() {
            if (!this.userId) return
            try {
                await copyToClipboard(this.userId)
                this.copyStatus = "Copied to clipboard."
                showToast("Discord ID copied to clipboard.")
            } catch (error) {
                this.copyStatus = "Unable to copy the ID."
                showToast("Unable to copy the ID.")
            } finally {
                if (this.copyStatusTimeout) {
                    clearTimeout(this.copyStatusTimeout)
                }
                this.copyStatusTimeout = setTimeout(() => {
                    this.copyStatus = null
                    this.copyStatusTimeout = null
                }, 2500)
            }
        }
    }
}
</script>
