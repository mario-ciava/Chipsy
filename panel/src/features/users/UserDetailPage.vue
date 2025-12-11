<template>
    <div class="chip-section">
        <section class="chip-card chip-stack">
            <header class="chip-card__header">
                <div class="chip-stack">
                    <div class="flex flex-wrap items-center gap-3 text-slate-300">
                        <span class="chip-eyebrow">User detail</span>
                        <span class="chip-role-badge" :class="roleBadgeClass">{{ roleLabel }}</span>
                        <span v-if="isBlacklisted" class="chip-pill chip-pill-danger">
                            Blacklisted
                        </span>
                        <span v-if="isSelfProfile" class="chip-pill chip-pill-info">Your profile</span>
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
            <div v-if="loading" class="chip-empty">Loading data…</div>
            <div v-else-if="error" class="chip-notice chip-notice-warning">{{ error }}</div>
            <div v-else class="chip-stack">
                <div v-if="statusBanner" :class="statusBannerClass">
                    {{ statusBanner.message }}
                </div>
                <div class="grid gap-6 md:grid-cols-2">
                    <article
                        v-for="section in overviewSections"
                        :key="section.id"
                        class="chip-stack gap-4"
                    >
                        <div
                            class="chip-stack gap-3"
                            :class="section.scrollable ? 'chip-status-scroll max-h-[320px] pr-1' : ''"
                        >
                            <div
                                v-for="(item, index) in section.items"
                                :key="item.label"
                                class="chip-status__row"
                                :class="index === section.items.length - 1 ? '' : 'border-b border-white/5 pb-3'"
                            >
                                <div class="flex flex-col">
                                    <span class="chip-status__label">{{ item.label }}</span>
                                    <span v-if="item.hint" class="chip-field-hint">{{ item.hint }}</span>
                                </div>
                                <span class="chip-status__value" :class="item.toneClass || ''">
                                    {{ item.value }}
                                </span>
                            </div>
                        </div>
                    </article>
                </div>
            </div>
        </section>

        <section class="chip-card chip-stack">
            <header class="chip-card__header">
                <div class="chip-stack">
                    <span class="chip-eyebrow">Access control</span>
                    <h3 class="text-2xl font-semibold text-white">Roles & switches</h3>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Adjust the panel reach for this profile and flip whitelist or blacklist flags without jumping between cards.
                    </p>
                </div>
            </header>
            <div class="chip-divider chip-divider--strong"></div>
            <div class="chip-stack gap-10 xl:grid xl:grid-cols-[320px_minmax(0,_1fr)] xl:gap-12 xl:items-start">
                <div class="chip-stack gap-8 xl:max-w-[360px]">
                    <section
                        class="chip-stack gap-4"
                        :class="roleSectionClass"
                        :aria-disabled="roleSectionDisabled"
                    >
                        <div class="chip-stack">
                        <label for="user-role" class="chip-label text-white">Role</label>
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
                        </div>
                        <p
                            v-if="roleSectionDisabled"
                            class="chip-field-hint text-slate-500"
                        >
                            You cannot change your own role. Ask another admin for access updates.
                        </p>
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
                                :disabled="!roleDirty || roleForm.saving || roleSectionDisabled"
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
                    </section>
                    <section class="chip-stack gap-4">
                        <div class="flex flex-col gap-4">
                            <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <label class="chip-label text-white" for="whitelist-toggle">Whitelist</label>
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
                                    :disabled="!canEditLists || listsForm.saving"
                                    :tone="listsForm.pendingWhitelist ? 'ok' : 'warn'"
                                    aria-label="Whitelist toggle"
                                    @toggle="updateListField('pendingWhitelist', $event)"
                                />
                            </div>
                            <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <label class="chip-label text-white" for="blacklist-toggle">Blacklist</label>
                                    <p class="chip-field-hint text-slate-400">
                                        Silence every bot response for this ID.
                                    </p>
                                </div>
                                <ChipToggle
                                    id="blacklist-toggle"
                                    class="shrink-0"
                                    :label="listsForm.pendingBlacklist ? 'Enabled' : 'Disabled'"
                                    :checked="listsForm.pendingBlacklist"
                                    :busy="listsForm.saving"
                                    :disabled="blacklistToggleDisabled || listsForm.saving"
                                    :tone="listsForm.pendingBlacklist ? 'danger' : 'ok'"
                                    aria-label="Blacklist toggle"
                                    @toggle="updateListField('pendingBlacklist', $event)"
                                />
                            </div>
                        </div>
                        <p v-if="!canEditLists" class="chip-field-hint text-slate-400">
                            Only admins can manage whitelist or blacklist entries.
                        </p>
                        <p v-else-if="isPrivilegedTarget && !listsForm.pendingBlacklist" class="chip-field-hint text-slate-400">
                            Privileged roles cannot be blacklisted.
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
                        <p class="chip-field-hint text-slate-500">
                            Last access update: {{ formatted.updatedAccess || "Not available" }}
                        </p>
                    </section>
                </div>
                <section class="chip-stack gap-6 border-t border-white/5 pt-6 xl:border-t-0 xl:border-l xl:border-white/5 xl:pl-10">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">Progression</span>
                        <h3 class="text-2xl font-semibold text-white">Profile overrides</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            Tune level, experience and bankroll values without leaving the panel. These updates apply instantly to the bot.
                        </p>
                    </div>
                    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4">
                        <div class="chip-stack">
                            <label class="chip-label text-white" for="stat-level">Level</label>
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
                            <label class="chip-label text-white" for="stat-exp">Experience</label>
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
                            <label class="chip-label text-white" for="stat-money">Money</label>
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
                            <label class="chip-label text-white" for="stat-gold">Gold</label>
                            <input
                                id="stat-gold"
                                v-model.number="statsForm.gold"
                                type="number"
                                min="0"
                                class="chip-input"
                                :disabled="statsForm.saving || !canEditStats"
                            >
                            <p class="chip-field-hint">Stored gold balance.</p>
                        </div>
                    </div>
                    <p v-if="!canEditStats" class="chip-field-hint text-slate-400">
                        {{ statsRestrictionMessage }}
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
                </section>
            </div>
        </section>
    </div>
</template>

<script>
import { mapGetters, mapState } from "vuex"
import api from "../../services/api"
import { ROLE_OPTIONS, getRoleLabel, getRoleDescription, getRoleBadgeClass } from "../../constants/roles"
import ChipToggle from "../dashboard/components/ChipToggle.vue"
import { USER_DETAIL_OVERVIEW } from "../../config/userDetailLayout"
import {
    formatCurrency,
    formatPercentage,
    formatExpRange,
    formatDetailedDateTime,
    formatFriendlyDateTime
} from "../../utils/formatters"

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
            }
        }
    },
    computed: {
        ...mapState("session", {
            csrfToken: (state) => state.csrfToken,
            sessionUser: (state) => state.user
        }),
        ...mapGetters("session", {
            canManageRoles: "canManageRoles",
            canManageLists: "canManageLists",
            canAssignAdmin: "canAssignAdmin",
            canAssignModerator: "canAssignModerator",
            panelConfig: "panelConfig"
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
        allowsMasterSelfOverrides() {
            const overrides = this.panelConfig?.users?.overrides
            if (typeof overrides?.masterSelfEditEnabled === "boolean") {
                return overrides.masterSelfEditEnabled
            }
            return true
        },
        isSelfProfile() {
            const sessionId = this.sessionUser?.id
            if (!sessionId) {
                return false
            }
            return String(sessionId) === String(this.userId)
        },
        formatted() {
            const user = this.user || {}
            const getNumber = (...candidates) => {
                for (const value of candidates) {
                    const numeric = Number(value)
                    if (Number.isFinite(numeric)) {
                        return numeric
                    }
                }
                return 0
            }
            const formatCount = (...values) => getNumber(...values).toLocaleString()
            const pickDate = (...values) => values.find((value) => value) || null
            const trimDateLabel = (value) => {
                if (!value) return "Unknown"
                return value.includes(" at ") ? value.split(" at ")[0] : value
            }
            const handsPlayedRaw = getNumber(user.hands_played, user.handsPlayed)
            const handsWonRaw = getNumber(user.hands_won, user.handsWon)
            const handsLostRaw = Math.max(handsPlayedRaw - handsWonRaw, 0)
            const joinDate = pickDate(user.join_date, user.joinDate)
            const nextReward = pickDate(user.next_reward, user.nextReward)

            return {
                money: formatCurrency(getNumber(user.money)),
                gold: formatCount(user.gold),
                biggestWon: formatCurrency(getNumber(user.biggest_won, user.biggestWon)),
                biggestBet: formatCurrency(getNumber(user.biggest_bet, user.biggestBet)),
                level: user.level !== undefined ? user.level : 0,
                exp: formatExpRange(
                    getNumber(user.current_exp, user.currentExp),
                    getNumber(user.required_exp, user.requiredExp)
                ),
                winRate: formatPercentage(user.winRate),
                lastPlayed: formatFriendlyDateTime(pickDate(user.last_played, user.lastPlayed)),
                nextReward: nextReward ? formatFriendlyDateTime(nextReward) : "Available",
                playerSince: trimDateLabel(joinDate ? formatFriendlyDateTime(joinDate) : null),
                netWinnings: formatCurrency(getNumber(user.net_winnings, user.netWinnings)),
                updatedAccess: formatDetailedDateTime(user.access?.updatedAt),
                handsWon: handsWonRaw.toLocaleString(),
                handsPlayed: handsPlayedRaw.toLocaleString(),
                handsLost: handsLostRaw.toLocaleString()
            }
        },
        targetRole() {
            return (this.roleForm.current || this.user?.access?.role || this.user?.panelRole || "USER")
                .toString()
                .toUpperCase()
        },
        isMasterTarget() {
            return this.targetRole === "MASTER"
        },
        isPrivilegedTarget() {
            return ["MASTER", "ADMIN", "MODERATOR"].includes(this.targetRole)
        },
        whitelistActive() {
            return Boolean(this.accessPolicy?.enforceWhitelist)
        },
        isBlacklisted() {
            return Boolean(this.user?.access?.isBlacklisted)
        },
        canEditRole() {
            return this.canManageRoles && !this.isMasterTarget && !this.isSelfProfile
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
            if (this.user.access.isWhitelisted && this.whitelistActive) {
                return {
                    tone: "info",
                    message: "Whitelist enforcement is active and this account is allowed to use Chipsy."
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
        },
        roleBadgeClass() {
            const roleCandidate =
                this.roleForm.pending || this.roleForm.current || this.user?.panelRole || this.user?.access?.role
            return getRoleBadgeClass(roleCandidate)
        },
        roleSectionDisabled() {
            return this.isSelfProfile || !this.canManageRoles
        },
        roleSectionClass() {
            return this.roleSectionDisabled ? "opacity-60 grayscale" : ""
        },
        blacklistToggleDisabled() {
            return !this.canEditLists || this.isPrivilegedTarget
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
            return {
                money: this.formatted.money,
                gold: this.formatted.gold,
                biggestWon: this.formatted.biggestWon,
                biggestBet: this.formatted.biggestBet,
                level: this.formatted.level,
                exp: this.formatted.exp,
                winRate: this.formatted.winRate,
                lastPlayed: this.formatted.lastPlayed,
                nextReward: this.formatted.nextReward,
                playerSince: this.formatted.playerSince,
                handsWon: this.formatted.handsWon,
                handsPlayed: this.formatted.handsPlayed,
                handsLost: this.formatted.handsLost,
                netWinnings: this.formatted.netWinnings
            }
        },
        overviewSections() {
            return USER_DETAIL_OVERVIEW.map((section) => {
                const items = (section.fields || []).map((field) => ({
                    label: field.label,
                    value: this.overviewValues[field.key] ?? field.fallback ?? "—",
                    hint: field.hint || null,
                    toneClass: field.toneClass || null
                }))
                return {
                    id: section.id,
                    title: section.title,
                    items,
                    scrollable: items.length > 4
                }
            })
        },
        canEditStats() {
            if (!this.canManageRoles) {
                return false
            }
            if (!this.isMasterTarget) {
                return true
            }
            return this.isSelfProfile && this.allowsMasterSelfOverrides
        },
        statsRestrictionMessage() {
            if (!this.canManageRoles) {
                return "Only panel admins can edit progression values."
            }
            if (this.isMasterTarget && !this.isSelfProfile) {
                return "Only the owner can override a master profile."
            }
            if (this.isSelfProfile && !this.allowsMasterSelfOverrides) {
                return "Self overrides are disabled for master accounts."
            }
            return "Editing is disabled for this profile."
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
    watch: {
        "roleForm.pending"() {
            this.roleForm.error = null
            this.roleForm.success = null
        },
        "listsForm.pendingWhitelist"(value) {
            this.listsForm.error = null
            this.listsForm.success = null
            if (value && this.listsForm.pendingBlacklist) {
                this.listsForm.pendingBlacklist = false
            }
        },
        "listsForm.pendingBlacklist"(value) {
            this.listsForm.error = null
            this.listsForm.success = null
            if (value && this.listsForm.pendingWhitelist) {
                this.listsForm.pendingWhitelist = false
            }
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
        }
    }
}
</script>
