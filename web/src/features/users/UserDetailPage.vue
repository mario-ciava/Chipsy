<template>
    <div class="chip-section">
        <section class="chip-card chip-stack">
            <header class="chip-card__header">
                <div class="chip-stack">
                    <div class="flex flex-wrap items-center gap-3 text-slate-300">
                        <span class="chip-eyebrow">User detail</span>
                        <span :class="roleBadgeClass">{{ roleLabel }}</span>
                    </div>
                    <h1 class="chip-heading">{{ userDisplayName }}</h1>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Overview of the stored bankroll data and this account&apos;s panel privileges.
                    </p>
                </div>
                <router-link to="/control_panel" class="chip-btn chip-btn-ghost chip-btn-fixed">
                    ← Back to panel
                </router-link>
            </header>
            <div class="chip-divider chip-divider--strong"></div>
            <div class="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                <span class="chip-label">Discord ID</span>
                <code class="font-mono text-base text-white">{{ userId }}</code>
                <button
                    type="button"
                    class="chip-btn chip-btn-ghost"
                    @click="copyUserId"
                    aria-label="Copy Discord ID"
                >
                    Copy
                </button>
            </div>
            <p v-if="copyStatus" class="chip-field-hint text-slate-400">
                {{ copyStatus }}
            </p>
            <div v-if="loading" class="chip-empty">Loading data…</div>
            <div v-else-if="error" class="chip-notice chip-notice-warning">{{ error }}</div>
            <div v-else class="chip-stack">
                <div v-if="statusBanner" :class="statusBannerClass">
                    {{ statusBanner.message }}
                </div>
                <div class="chip-grid chip-grid--auto w-full">
                    <article
                        v-for="section in overviewSections"
                        :key="section.id"
                        class="chip-metric-group"
                    >
                        <h2 class="chip-metric-group__title">{{ section.title }}</h2>
                        <dl class="chip-metric-group__list">
                            <div v-for="item in section.items" :key="item.label" class="chip-metric-group__row">
                                <dt class="chip-metric-group__label">{{ item.label }}</dt>
                                <dd class="chip-metric-group__value">{{ item.value }}</dd>
                            </div>
                        </dl>
                    </article>
                </div>
            </div>
        </section>

        <section class="chip-grid chip-grid--filters w-full">
            <article class="chip-card chip-stack">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">Access control</span>
                        <h3 class="text-2xl font-semibold text-white">Role management</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            Assign a new role to define which areas of the control panel this account can reach.
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong"></div>
                <div class="chip-stack">
                    <label for="user-role" class="chip-label">Role</label>
                    <select
                        id="user-role"
                        v-model="roleForm.pending"
                        class="chip-select"
                        :disabled="!canEditRole || roleForm.saving"
                    >
                        <option v-for="role in availableRoleOptions" :key="role.value" :value="role.value">
                            {{ role.label }}
                        </option>
                    </select>
                    <p class="chip-field-hint text-slate-400">{{ roleDescription }}</p>
                    <div class="flex flex-wrap items-center justify-center gap-3 text-center">
                        <button
                            type="button"
                            class="chip-btn chip-btn-secondary"
                            :disabled="!roleDirty || !canEditRole || roleForm.saving"
                            @click="saveRole"
                        >
                            <span v-if="roleForm.saving" class="chip-spinner"></span>
                            <span v-else>Save</span>
                        </button>
                        <button
                            type="button"
                            class="chip-btn chip-btn-ghost"
                            :disabled="!roleDirty || roleForm.saving"
                            @click="resetRoleForm"
                        >
                            Reset
                        </button>
                    </div>
                    <p
                        v-if="roleForm.error"
                        class="chip-field-hint text-rose-200"
                        role="status"
                        aria-live="polite"
                    >
                        {{ roleForm.error }}
                    </p>
                    <p
                        v-else-if="roleForm.success"
                        class="chip-field-hint text-emerald-200"
                        role="status"
                        aria-live="polite"
                    >
                        {{ roleForm.success }}
                    </p>
                </div>
            </article>

            <article class="chip-card chip-stack">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">Lists</span>
                        <h3 class="text-2xl font-semibold text-white">Access switches</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            Toggle whitelist or blacklist for this ID without leaving the profile. Whitelist enforcement is
                            <strong>{{ whitelistActive ? 'active' : 'inactive' }}</strong>.
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong"></div>
                <div class="chip-stack">
                    <div class="flex flex-col gap-4">
                        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <label class="chip-label" for="whitelist-toggle">Whitelist</label>
                                <p class="chip-field-hint text-slate-400">
                                    Admit this ID whenever whitelist locks are enforced.
                                </p>
                            </div>
                            <ChipToggle
                                id="whitelist-toggle"
                                class="shrink-0"
                                :label="listsForm.pendingWhitelist ? 'Enabled' : 'Disabled'"
                                :checked="listsForm.pendingWhitelist"
                                :busy="listsForm.saving"
                                :disabled="!canEditLists"
                                :tone="listsForm.pendingWhitelist ? 'ok' : 'warn'"
                                aria-label="Whitelist toggle"
                                @toggle="updateListField('pendingWhitelist', $event)"
                            />
                        </div>
                        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                            <div>
                                <label class="chip-label" for="blacklist-toggle">Blacklist</label>
                                <p class="chip-field-hint text-slate-400">
                                    Silence every bot response for this ID permanently.
                                </p>
                            </div>
                            <ChipToggle
                                id="blacklist-toggle"
                                class="shrink-0"
                                :label="listsForm.pendingBlacklist ? 'Enabled' : 'Disabled'"
                                :checked="listsForm.pendingBlacklist"
                                :busy="listsForm.saving"
                                :disabled="!canEditLists"
                                :tone="listsForm.pendingBlacklist ? 'danger' : 'ok'"
                                aria-label="Blacklist toggle"
                                @toggle="updateListField('pendingBlacklist', $event)"
                            />
                        </div>
                    </div>
                    <p v-if="!canEditLists" class="chip-field-hint text-slate-400">
                        Only admins can manage whitelist or blacklist entries.
                    </p>
                    <div class="flex flex-wrap items-center justify-center gap-3 text-center">
                        <button
                            type="button"
                            class="chip-btn chip-btn-secondary"
                            :disabled="!listsDirty || !canEditLists || listsForm.saving"
                            @click="saveLists"
                        >
                            <span v-if="listsForm.saving" class="chip-spinner"></span>
                            <span v-else>Save</span>
                        </button>
                        <button
                            type="button"
                            class="chip-btn chip-btn-ghost"
                            :disabled="!listsDirty || listsForm.saving"
                            @click="resetListsForm"
                        >
                            Reset
                        </button>
                    </div>
                    <p
                        v-if="listsForm.error"
                        class="chip-field-hint text-rose-200"
                        role="status"
                        aria-live="polite"
                    >
                        {{ listsForm.error }}
                    </p>
                    <p
                        v-else-if="listsForm.success"
                        class="chip-field-hint text-emerald-200"
                        role="status"
                        aria-live="polite"
                    >
                        {{ listsForm.success }}
                    </p>
                </div>
            </article>
        </section>

        <section class="chip-card chip-stack">
            <header class="chip-card__header">
                <div class="chip-stack">
                    <span class="chip-eyebrow">Progression</span>
                    <h3 class="text-2xl font-semibold text-white">Profile overrides</h3>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Tune level, experience, and bankroll values without leaving the panel. These updates apply instantly to the bot.
                    </p>
                </div>
            </header>
            <div class="chip-divider chip-divider--strong"></div>
            <div class="chip-stack">
                <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div class="chip-stack">
                        <label class="chip-label" for="stat-level">Level</label>
                        <input
                            id="stat-level"
                            v-model.number="statsForm.level"
                            type="number"
                            min="0"
                            max="500"
                            class="chip-input"
                            :disabled="statsForm.saving || !canEditStats"
                        >
                        <p class="chip-field-hint">Player tier (0-500).</p>
                    </div>
                    <div class="chip-stack">
                        <label class="chip-label" for="stat-exp">Experience</label>
                        <input
                            id="stat-exp"
                            v-model.number="statsForm.currentExp"
                            type="number"
                            min="0"
                            class="chip-input"
                            :disabled="statsForm.saving || !canEditStats"
                        >
                        <p class="chip-field-hint">Current XP progress.</p>
                    </div>
                    <div class="chip-stack">
                        <label class="chip-label" for="stat-money">Money</label>
                        <input
                            id="stat-money"
                            v-model.number="statsForm.money"
                            type="number"
                            min="0"
                            class="chip-input"
                            :disabled="statsForm.saving || !canEditStats"
                        >
                        <p class="chip-field-hint">Bankroll on record.</p>
                    </div>
                    <div class="chip-stack">
                        <label class="chip-label" for="stat-gold">Gold</label>
                        <input
                            id="stat-gold"
                            v-model.number="statsForm.gold"
                            type="number"
                            min="0"
                            class="chip-input"
                            :disabled="statsForm.saving || !canEditStats"
                        >
                        <p class="chip-field-hint">Legacy gold tokens.</p>
                    </div>
                </div>
                <p v-if="!canEditStats" class="chip-field-hint text-slate-400">
                    Only admins can edit progression values.
                </p>
                <div class="flex flex-wrap items-center justify-center gap-3 text-center">
                    <button
                        type="button"
                        class="chip-btn chip-btn-secondary"
                        :disabled="!statsDirty || !canEditStats || statsForm.saving"
                        @click="saveStats"
                    >
                        <span v-if="statsForm.saving" class="chip-spinner"></span>
                        <span v-else>Save</span>
                    </button>
                    <button
                        type="button"
                        class="chip-btn chip-btn-ghost"
                        :disabled="!statsDirty || statsForm.saving"
                        @click="resetStatsForm"
                    >
                        Reset
                    </button>
                </div>
                <p
                    v-if="statsForm.error"
                    class="chip-field-hint text-rose-200"
                    role="status"
                    aria-live="polite"
                >
                    {{ statsForm.error }}
                </p>
                <p
                    v-else-if="statsForm.success"
                    class="chip-field-hint text-emerald-200"
                    role="status"
                    aria-live="polite"
                >
                    {{ statsForm.success }}
                </p>
            </div>
        </section>
    </div>
</template>

<script>
import { mapGetters, mapState } from "vuex"
import api from "../../services/api"
import { ROLE_OPTIONS, getRoleLabel, getRoleDescription } from "../../constants/roles"
import ChipToggle from "../dashboard/components/ChipToggle.vue"
import { USER_DETAIL_OVERVIEW } from "../../config/userDetailLayout"
import {
    formatCurrency,
    formatPercentage,
    formatExpRange,
    formatDetailedDateTime,
    formatFriendlyDateTime
} from "../../utils/formatters"
import { showToast } from "../../utils/toast"
import { copyToClipboard } from "../../utils/clipboard"

const ROLE_BADGE_CLASSES = Object.freeze({
    MASTER: "chip-pill-warning",
    ADMIN: "chip-pill-info",
    MODERATOR: "chip-pill-ghost",
    USER: "chip-pill-ghost"
})

export default {
    name: "UserDetailPage",
    components: {
        ChipToggle
    },
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
            statsForm: {
                level: 0,
                currentExp: 0,
                money: 0,
                gold: 0,
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
                updatedAccess: formatDetailedDateTime(user.access?.updatedAt),
                handsWon: Number.isFinite(Number(user.hands_won)) ? Number(user.hands_won).toLocaleString() : "0",
                handsPlayed: Number.isFinite(Number(user.hands_played)) ? Number(user.hands_played).toLocaleString() : "0"
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
                return null
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
        },
        roleBadgeClass() {
            const roleKey = (this.roleForm.pending || this.roleForm.current || "").toUpperCase()
            return ROLE_BADGE_CLASSES[roleKey] || "chip-pill"
        },
        baseStats() {
            const user = this.user || {}
            const resolveNumber = (value) => {
                const numeric = Number(value)
                return Number.isFinite(numeric) ? numeric : 0
            }
            const expValue = user.current_exp !== undefined ? user.current_exp : user.currentExp
            return {
                level: resolveNumber(user.level),
                currentExp: resolveNumber(expValue),
                money: resolveNumber(user.money),
                gold: resolveNumber(user.gold)
            }
        },
        overviewValues() {
            const access = this.user?.access || {}
            return {
                money: this.formatted.money,
                gold: this.formatted.gold,
                biggestWon: this.formatted.biggestWon,
                biggestBet: this.formatted.biggestBet,
                level: this.formatted.level,
                exp: this.formatted.exp,
                winRate: this.formatted.winRate,
                lastPlayed: this.formatted.lastPlayed,
                handsWon: this.formatted.handsWon,
                handsPlayed: this.formatted.handsPlayed,
                role: this.roleLabel,
                whitelist: access.isWhitelisted ? "Enabled" : "Disabled",
                blacklist: access.isBlacklisted ? "Enabled" : "Disabled",
                updatedAccess: this.formatted.updatedAccess || "Not available"
            }
        },
        overviewSections() {
            return USER_DETAIL_OVERVIEW.map((section) => ({
                id: section.id,
                title: section.title,
                items: (section.fields || []).map((field) => ({
                    label: field.label,
                    value: this.overviewValues[field.key] ?? field.fallback ?? "—"
                }))
            }))
        },
        canEditStats() {
            return this.canManageRoles && !this.isMasterTarget
        },
        statsDirty() {
            const base = this.baseStats
            return (
                base.level !== Number(this.statsForm.level)
                || base.currentExp !== Number(this.statsForm.currentExp)
                || base.money !== Number(this.statsForm.money)
                || base.gold !== Number(this.statsForm.gold)
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
        },
        "statsForm.level"() {
            this.statsForm.error = null
            this.statsForm.success = null
        },
        "statsForm.currentExp"() {
            this.statsForm.error = null
            this.statsForm.success = null
        },
        "statsForm.money"() {
            this.statsForm.error = null
            this.statsForm.success = null
        },
        "statsForm.gold"() {
            this.statsForm.error = null
            this.statsForm.success = null
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
            this.syncStatsForm()
        },
        syncStatsForm() {
            const stats = this.baseStats
            this.statsForm.level = stats.level
            this.statsForm.currentExp = stats.currentExp
            this.statsForm.money = stats.money
            this.statsForm.gold = stats.gold
            this.statsForm.error = null
            this.statsForm.success = null
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
        async saveStats() {
            if (!this.canEditStats || !this.statsDirty) return
            if (!this.csrfToken) {
                this.statsForm.error = "Missing CSRF token."
                return
            }
            this.statsForm.saving = true
            this.statsForm.error = null
            this.statsForm.success = null
            try {
                const response = await api.updateUserStats({
                    csrfToken: this.csrfToken,
                    userId: this.userId,
                    level: Number(this.statsForm.level),
                    currentExp: Number(this.statsForm.currentExp),
                    money: Number(this.statsForm.money),
                    gold: Number(this.statsForm.gold)
                })
                this.mergeUserPayload(response)
                this.syncStatsForm()
                this.statsForm.success = "Progression updated successfully."
            } catch (error) {
                this.statsForm.error = error?.response?.data?.message || "Unable to update the progression."
            } finally {
                this.statsForm.saving = false
            }
        },
        resetStatsForm() {
            if (this.statsForm.saving) return
            this.syncStatsForm()
        },
        resetRoleForm() {
            if (this.roleForm.saving) return
            this.roleForm.pending = this.roleForm.current
            this.roleForm.error = null
            this.roleForm.success = null
        },
        resetListsForm() {
            if (this.listsForm.saving) return
            this.listsForm.pendingWhitelist = this.listsForm.currentWhitelist
            this.listsForm.pendingBlacklist = this.listsForm.currentBlacklist
            this.listsForm.error = null
            this.listsForm.success = null
        },
        updateListField(field, value) {
            if (!Object.prototype.hasOwnProperty.call(this.listsForm, field)) {
                return
            }
            if (!this.canEditLists || this.listsForm.saving) {
                return
            }
            this.listsForm[field] = Boolean(value)
        },
        mergeUserPayload(payload = {}) {
            if (!payload) return
            const current = this.user || {}
            const next = {
                ...current,
                ...payload
            }
            const currentExpValue = payload.current_exp ?? payload.currentExp
            if (currentExpValue !== undefined) {
                next.currentExp = currentExpValue
                next.current_exp = currentExpValue
            }
            const requiredExpValue = payload.required_exp ?? payload.requiredExp
            if (requiredExpValue !== undefined) {
                next.requiredExp = requiredExpValue
                next.required_exp = requiredExpValue
            }
            this.user = next
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
