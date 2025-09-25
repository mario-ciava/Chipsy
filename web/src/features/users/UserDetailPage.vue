<template>
    <div class="page user-detail">
        <div class="card user-detail__card">
            <header class="user-detail__header">
                <div>
                    <h1 class="user-detail__title">{{ userDisplayName }}</h1>
                    <div class="user-detail__id-row">
                        <span class="user-detail__subtitle user-detail__id-label">Discord ID</span>
                        <code class="user-detail__id-value">{{ userId }}</code>
                        <button
                            type="button"
                            class="button button--ghost button--icon"
                            @click="copyUserId"
                            aria-label="Copy Discord ID"
                        >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                                <rect x="6" y="6" width="9" height="9" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5" />
                                <rect x="3" y="3" width="9" height="9" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5" />
                            </svg>
                            <span class="sr-only">Copy ID</span>
                        </button>
                    </div>
                    <p v-if="copyStatus" class="copy-status">{{ copyStatus }}</p>
                    <p class="user-detail__description">
                        Overview of the stored bankroll data and this account's panel privileges.
                    </p>
                </div>
                <router-link to="/control_panel" class="button button--ghost">
                    ← Back to panel
                </router-link>
            </header>

            <div v-if="loading" class="user-detail__loading">Loading data…</div>
            <div v-else-if="error" class="user-detail__error">{{ error }}</div>
            <div v-else>
                <div
                    v-if="statusBanner"
                    class="user-detail__alert"
                    :class="`user-detail__alert--${statusBanner.tone}`"
                >
                    {{ statusBanner.message }}
                </div>
                <div class="user-detail__grid">
                    <section class="user-detail__section-card user-detail__section-card--balances">
                        <h2 class="user-detail__section-title">Balances</h2>
                        <ul class="user-detail__list user-detail__list--two-col">
                            <li><span>Balance</span><strong>{{ formatted.money }}</strong></li>
                            <li><span>Gold</span><strong>{{ formatted.gold }}</strong></li>
                            <li><span>Biggest win</span><strong>{{ formatted.biggestWon }}</strong></li>
                            <li><span>Biggest bet</span><strong>{{ formatted.biggestBet }}</strong></li>
                        </ul>
                    </section>
                    <section class="user-detail__section-card">
                        <h2 class="user-detail__section-title">Progression</h2>
                        <ul class="user-detail__list user-detail__list--two-col">
                            <li><span>Level</span><strong>{{ formatted.level }}</strong></li>
                            <li><span>Exp</span><strong>{{ formatted.exp }}</strong></li>
                            <li><span>Win rate</span><strong>{{ formatted.winRate }}</strong></li>
                            <li><span>Last activity</span><strong>{{ formatted.lastPlayed }}</strong></li>
                        </ul>
                    </section>
                    <section class="user-detail__section-card user-detail__section-card--access">
                        <h2 class="user-detail__section-title">Panel access</h2>
                        <ul class="user-detail__list user-detail__list--stacked">
                            <li><span>Role</span><strong>{{ roleLabel }}</strong></li>
                            <li>
                                <span>Whitelist</span>
                                <strong>{{ user.access?.isWhitelisted ? "Enabled" : "Disabled" }}</strong>
                            </li>
                            <li>
                                <span>Blacklist</span>
                                <strong>{{ user.access?.isBlacklisted ? "Enabled" : "Disabled" }}</strong>
                            </li>
                            <li>
                                <span>Last update</span>
                                <strong>{{ formatted.updatedAccess || "Not available" }}</strong>
                            </li>
                        </ul>
                    </section>
                </div>

                <div class="user-detail__access">
                    <section class="access-card">
                        <h3 class="access-card__title">Role management</h3>
                        <p class="access-card__copy">
                            Assign a new role to define which areas of the control panel this account can reach.
                        </p>
                        <label class="form-label" for="role-select">Role</label>
                        <div class="select-control">
                            <select
                                id="role-select"
                                v-model="roleForm.pending"
                                class="form-input form-input--select"
                                :disabled="!canEditRole || roleForm.saving || availableRoleOptions.length === 0"
                            >
                                <option v-for="option in availableRoleOptions" :key="option.value" :value="option.value">
                                    {{ option.label }}
                                </option>
                            </select>
                            <span class="select-control__icon" aria-hidden="true">
                                <svg viewBox="0 0 16 16" focusable="false">
                                    <path d="M3.5 6l4.5 4 4.5-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                            </span>
                        </div>
                        <p class="form-role-description">
                            {{ roleDescription }}
                        </p>
                        <p v-if="!canEditRole" class="form-hint">
                            You don't have permissions to change this role or the user is the current master.
                        </p>
                        <div class="form-actions">
                            <button
                                type="button"
                                class="button button--secondary"
                                :disabled="!roleDirty || !canEditRole || roleForm.saving"
                                @click="saveRole"
                            >
                                <span v-if="roleForm.saving" class="button__spinner"></span>
                                <span v-else>Update role</span>
                            </button>
                            <span v-if="roleForm.error" class="form-feedback">{{ roleForm.error }}</span>
                            <span v-else-if="roleForm.success" class="form-feedback form-feedback--success">
                                {{ roleForm.success }}
                            </span>
                        </div>
                    </section>

                    <section class="access-card">
                        <h3 class="access-card__title">Access lists</h3>
                        <p class="access-card__copy">
                            Blacklist permanently blocks the bot for this account. Whitelist grants access while whitelist mode is active (currently
                            <strong>{{ whitelistActive ? "active" : "inactive" }}</strong>).
                        </p>
                        <div class="toggle-group">
                            <label class="toggle">
                                <input
                                    type="checkbox"
                                    v-model="listsForm.pendingWhitelist"
                                    :disabled="!canEditLists || listsForm.saving"
                                >
                                <span>Whitelist</span>
                            </label>
                            <label class="toggle">
                                <input
                                    type="checkbox"
                                    v-model="listsForm.pendingBlacklist"
                                    :disabled="!canEditLists || listsForm.saving"
                                >
                                <span>Blacklist</span>
                            </label>
                        </div>
                        <p v-if="!canEditLists" class="form-hint">
                            Only admins can manage whitelist/blacklist entries.
                        </p>
                        <div class="form-actions">
                            <button
                                type="button"
                                class="button button--ghost"
                                :disabled="!listsDirty || !canEditLists || listsForm.saving"
                                @click="saveLists"
                            >
                                <span v-if="listsForm.saving" class="button__spinner"></span>
                                <span v-else>Save lists</span>
                            </button>
                            <span v-if="listsForm.error" class="form-feedback">{{ listsForm.error }}</span>
                            <span v-else-if="listsForm.success" class="form-feedback form-feedback--success">
                                {{ listsForm.success }}
                            </span>
                        </div>
                    </section>
                </div>
            </div>
        </div>
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
                gold: formatCurrency(user.gold),
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
