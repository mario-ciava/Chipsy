<template>
    <section class="chip-card chip-stack chip-table-shell" aria-labelledby="user-table-title">
        <header class="chip-card__header items-start">
            <div class="chip-stack">
                <div class="flex items-center gap-2">
                    <span class="chip-eyebrow">User stats</span>
                    <span
                        class="chip-info-dot"
                        role="img"
                        tabindex="0"
                        aria-label="User metrics"
                        data-tooltip="Data pulled from MySQL snapshots."
                    ></span>
                </div>
                <h3 id="user-table-title" class="chip-card__title">User intelligence</h3>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Review the data stored in MySQL to monitor balances and progress.
                </p>
            </div>
        </header>

        <div class="chip-divider chip-divider--strong my-1"></div>

        <form class="chip-filter-form chip-stack gap-5" aria-label="User filters" novalidate @submit.prevent="applyFilters">
            <div class="chip-search-toolbar">
                <div class="chip-toolbar__group">
                    <label class="sr-only" for="user-table-search">Search</label>
                    <input
                        id="user-table-search"
                        v-model="filtersDraft.search"
                        class="chip-input chip-input--bright-placeholder flex-1"
                        type="search"
                        :placeholder="searchPlaceholder"
                        autocomplete="off"
                        @keyup.enter="applyFilters"
                    />
                </div>
                <div class="chip-toolbar__actions">
                    <span class="chip-icon-counter" :aria-label="indexedUsersAriaLabel">
                        {{ indexedUsersLabel }}
                    </span>
                    <button
                        class="chip-icon-btn relative"
                        :class="filtersButtonTone"
                        type="button"
                        :aria-expanded="filtersOpen"
                        :aria-label="filtersButtonAriaLabel"
                        :title="filtersButtonAriaLabel"
                        aria-controls="user-table-filters"
                        @click="toggleFilters"
                    >
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 5h18" stroke-linecap="round" />
                            <path d="M6 12h12" stroke-linecap="round" />
                            <path d="M10 19h4" stroke-linecap="round" />
                        </svg>
                        <span
                            v-if="advancedFilterCount"
                            class="chip-filter-indicator"
                            aria-hidden="true"
                        ></span>
                    </button>
                    <button
                        class="chip-icon-btn"
                        type="button"
                        :disabled="loading"
                        aria-label="Refresh users"
                        title="Refresh users"
                        @click="refresh"
                    >
                        <span v-if="loading" class="chip-spinner"></span>
                        <span v-else aria-hidden="true">↻</span>
                    </button>
                </div>
            </div>

            <div
                v-if="userKpis.length"
                class="chip-search-stats"
                aria-label="User highlights"
                aria-live="polite"
            >
                <div
                    v-for="(column, columnIndex) in kpiColumns"
                    :key="`user-kpi-column-${columnIndex}`"
                    class="chip-search-column"
                >
                    <article
                        v-for="metric in column"
                        :key="metric.id"
                        class="chip-search-stat"
                    >
                        <div class="chip-search-stat__text">
                            <span class="chip-search-stat__label">{{ metric.label }}</span>
                            <span
                                v-if="metric.hint"
                                class="chip-field-hint chip-search-stat__hint"
                            >{{ metric.hint }}</span>
                        </div>
                        <span class="chip-search-stat__value">
                            {{ metric.value }}
                        </span>
                    </article>
                </div>
            </div>

            <transition name="fade">
                <section
                    v-if="filtersOpen"
                    id="user-table-filters"
                    class="chip-filter-panel"
                    aria-label="Advanced filters"
                >
                    <div class="chip-grid chip-grid--filters">
                        <label class="chip-filter-panel__field">
                            <span class="chip-label">Role</span>
                            <select v-model="filtersDraft.role" class="chip-select" :style="dropdownSelectStyle">
                                <option value="all">All roles</option>
                                <option value="MASTER">Master</option>
                                <option value="ADMIN">Admin</option>
                                <option value="MODERATOR">Moderator</option>
                                <option value="USER">User</option>
                            </select>
                        </label>
                        <label class="chip-filter-panel__field">
                            <span class="chip-label">Access list</span>
                            <select v-model="filtersDraft.list" class="chip-select" :style="dropdownSelectStyle">
                                <option value="all">Any</option>
                                <option value="whitelisted">Whitelisted</option>
                                <option value="neutral">Neutral</option>
                                <option value="blacklisted">Blacklisted</option>
                            </select>
                        </label>
                        <div class="chip-filter-panel__field">
                            <span class="chip-label">Level range</span>
                            <div class="chip-filter-panel__range">
                                <input v-model="filtersDraft.minLevel" class="chip-input" type="number" min="0" placeholder="Min" />
                                <span class="chip-filter-panel__divider">—</span>
                                <input v-model="filtersDraft.maxLevel" class="chip-input" type="number" min="0" placeholder="Max" />
                            </div>
                        </div>
                        <div class="chip-filter-panel__field">
                            <span class="chip-label">Balance range</span>
                            <div class="chip-filter-panel__range">
                                <input v-model="filtersDraft.minBalance" class="chip-input" type="number" min="0" placeholder="Min" />
                                <span class="chip-filter-panel__divider">—</span>
                                <input v-model="filtersDraft.maxBalance" class="chip-input" type="number" min="0" placeholder="Max" />
                            </div>
                        </div>
                        <label class="chip-filter-panel__field">
                            <span class="chip-label">Recent activity</span>
                            <select v-model="filtersDraft.activity" class="chip-select" :style="dropdownSelectStyle">
                                <option value="any">Any</option>
                                <option value="7d">Last 7 days</option>
                                <option value="30d">Last 30 days</option>
                                <option value="90d">Last 90 days</option>
                            </select>
                        </label>
                        <label class="chip-filter-panel__field">
                            <span class="chip-label">Sort by</span>
                            <select v-model="filtersDraft.sortBy" class="chip-select" :style="dropdownSelectStyle">
                                <option value="last_played">Last activity</option>
                                <option value="balance">Balance</option>
                                <option value="level">Level</option>
                            </select>
                        </label>
                        <label class="chip-filter-panel__field">
                            <span class="chip-label">Sort direction</span>
                            <select v-model="filtersDraft.sortDirection" class="chip-select" :style="dropdownSelectStyle">
                                <option value="desc">Descending</option>
                                <option value="asc">Ascending</option>
                            </select>
                        </label>
                    </div>

                    <div class="chip-filter-panel__footer">
                        <div class="chip-filter-panel__chips" aria-live="polite">
                            <button
                                v-for="chip in activeFilterChips"
                                :key="chip.id"
                                type="button"
                                class="chip-filter"
                                @click="clearFilter(chip.keys)"
                            >
                                <span>{{ chip.label }}</span>
                                <span class="chip-filter__remove" aria-hidden="true">×</span>
                            </button>
                            <span v-if="!activeFilterChips.length" class="chip-field-hint text-slate-500">
                                No filters applied
                            </span>
                        </div>
                        <div class="chip-filter-panel__cta">
                            <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="submit" :disabled="loading">
                                <span v-if="loading" class="chip-spinner"></span>
                                <span v-else>{{ applyButtonLabel }}</span>
                            </button>
                            <button
                                class="chip-btn chip-btn-ghost"
                                type="button"
                                :disabled="loading || !hasChanges"
                                @click="resetFilters"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                </section>
            </transition>
        </form>

        <table :id="tableId" class="chip-table">
            <thead>
                <tr>
                    <th>User</th>
                    <th>ID</th>
                    <th>Role</th>
                    <th>Balance</th>
                    <th>Level</th>
                    <th>Last activity</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr v-if="loading">
                    <td colspan="7" class="py-6 text-center text-slate-300">Loading data…</td>
                </tr>
                <tr v-else-if="!formattedUsers.length">
                    <td colspan="7" class="py-6 text-center text-slate-400">
                        No users match the current filters.
                    </td>
                </tr>
                <tr v-else v-for="user in formattedUsers" :key="user.id" class="transition hover:bg-white/5">
                    <td>
                        <div class="chip-table__username">
                            <span class="font-semibold text-white">{{ user.username }}</span>
                            <span v-if="user.tag" class="chip-table__meta">{{ user.tag }}</span>
                        </div>
                    </td>
                    <td class="font-mono text-sm text-slate-300">
                        {{ user.id }}
                    </td>
                    <td>
                        <span class="chip-role-badge" :class="user.roleClass">
                            {{ user.roleLabel }}
                        </span>
                    </td>
                    <td class="font-semibold chip-text-warning">{{ user.balance }}</td>
                    <td>
                        <div class="chip-table__username">
                            <span class="font-semibold text-white">{{ user.level }}</span>
                            <span class="chip-table__meta">{{ user.exp }}</span>
                        </div>
                    </td>
                    <td class="text-slate-200">{{ user.lastPlayed }}</td>
                    <td>
                        <div class="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                                title="Copy ID"
                                @click="copyId(user.id)"
                            >
                                Copy ID
                            </button>
                            <button
                                type="button"
                                class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                                @click="openDetails(user.id)"
                            >
                                Details
                            </button>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>

        <nav class="chip-pagination" aria-label="User pagination">
            <button
                class="chip-btn chip-btn-secondary chip-btn-fixed"
                :disabled="loading || pagination.page <= 1"
                :aria-controls="tableId"
                aria-label="Go to previous page"
                @click="changePage(pagination.page - 1)"
            >
                Previous
            </button>
            <span class="chip-pagination__meta text-slate-200" aria-live="polite">
                Page {{ pagination.page }} of {{ pagination.totalPages }}
            </span>
            <button
                class="chip-btn chip-btn-secondary chip-btn-fixed"
                :disabled="loading || pagination.page >= pagination.totalPages"
                :aria-controls="tableId"
                aria-label="Go to next page"
                @click="changePage(pagination.page + 1)"
            >
                Next
            </button>
        </nav>
    </section>
</template>

<script>
import { formatCurrency, formatPercentage, formatExpRange, formatFriendlyDateTime } from "../../../utils/formatters"
import { getRoleLabel } from "../../../constants/roles"
import { showToast } from "../../../utils/toast"
import { copyToClipboard } from "../../../utils/clipboard"
import { PANEL_DEFAULTS } from "../../../config/panelDefaults"

const toPositiveNumber = (value, fallback) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

const KPI_COLUMN_COUNT = 2

const ADVANCED_FILTER_KEYS = [
    "role",
    "list",
    "minLevel",
    "maxLevel",
    "minBalance",
    "maxBalance",
    "activity",
    "sortBy",
    "sortDirection"
]

export default {
    name: "UserTable",
    props: {
        users: {
            type: Array,
            default: () => []
        },
        pagination: {
            type: Object,
            default: () => ({
                page: 1,
                pageSize: 25,
                total: 0,
                totalPages: 1
            })
        },
        filters: {
            type: Object,
            default: () => ({})
        },
        loading: {
            type: Boolean,
            default: false
        }
    },
    data() {
        const normalized = this.normalizeFilters(this.filters)
        const defaults = this.normalizeFilters({})
        const hasAdvanced = ADVANCED_FILTER_KEYS.some((key) => normalized[key] !== defaults[key])
        return {
            filtersDraft: normalized,
            filtersOpen: hasAdvanced,
            filtersCollapsedManually: false
        }
    },
    computed: {
        tableId() {
            return "user-table"
        },
        normalizedFilters() {
            return this.normalizeFilters(this.filters)
        },
        kpiColumns() {
            const columns = Array.from({ length: KPI_COLUMN_COUNT }, () => [])
            this.userKpis.forEach((metric, index) => {
                const columnIndex = index % KPI_COLUMN_COUNT
                columns[columnIndex].push(metric)
            })
            return columns.filter((column) => column.length)
        },
        hasChanges() {
            const keys = Object.keys(this.filtersDraft)
            return keys.some((key) => this.filtersDraft[key] !== this.normalizedFilters[key])
        },
        searchPlaceholder() {
            return "Search by user ID or username…"
        },
        indexedUsersLabel() {
            const total = Number(this.pagination?.total) || 0
            const formatted = total.toLocaleString()
            return formatted
        },
        indexedUsersAriaLabel() {
            return `Indexed users: ${this.indexedUsersLabel}`
        },
        formattedUsers() {
            const roleToneMap = {
                master: "chip-role-master",
                admin: "chip-role-admin",
                moderator: "chip-role-moderator"
            }
            return this.users.map((user) => {
                const rawUsername = user.username || "N/A"
                let tag = user.tag || null
                let baseName = rawUsername
                if (!tag && rawUsername.includes("#")) {
                    const [namePart, discriminator] = rawUsername.split("#")
                    if (namePart) baseName = namePart
                    if (discriminator) tag = `#${discriminator}`
                }
                const normalizedRole = (user.panelRole || user.access?.role || "USER")
                    .toString()
                    .trim()
                    .toLowerCase()
                const roleClass = roleToneMap[normalizedRole] || "chip-role-user"
                return {
                    id: user.id,
                    balance: formatCurrency(user.money),
                    level: user.level,
                    exp: formatExpRange(
                        Number(user.current_exp !== undefined ? user.current_exp : user.currentExp),
                        Number(user.required_exp !== undefined ? user.required_exp : user.requiredExp)
                    ),
                    winRate: formatPercentage(user.winRate),
                    biggestWon: formatCurrency(user.biggest_won !== undefined ? user.biggest_won : user.biggestWon),
                    lastPlayed: formatFriendlyDateTime(user.last_played !== undefined ? user.last_played : user.lastPlayed),
                    username: baseName || "N/A",
                    tag,
                    roleLabel: getRoleLabel(user.panelRole || user.access?.role),
                    roleClass
                }
            })
        },
        panelDropdownTheme() {
            const config = this.$store?.getters?.["session/panelConfig"]
            return config?.dropdown || PANEL_DEFAULTS.dropdown
        },
        dropdownSelectStyle() {
            const theme = this.panelDropdownTheme || {}
            return {
                backgroundColor: theme.background,
                borderColor: theme.border,
                color: theme.optionText
            }
        },
        panelUserStatsTokens() {
            const config = this.$store?.getters?.["session/panelConfig"]
            return config?.userStats?.kpis || PANEL_DEFAULTS.userStats.kpis
        },
        kpiSettings() {
            const defaults = PANEL_DEFAULTS.userStats.kpis
            const settings = this.panelUserStatsTokens || defaults
            return {
                maxCards: toPositiveNumber(settings.maxCards, defaults.maxCards),
                veteranLevelThreshold: toPositiveNumber(
                    settings.veteranLevelThreshold,
                    defaults.veteranLevelThreshold
                ),
                vipBalanceThreshold: toPositiveNumber(settings.vipBalanceThreshold, defaults.vipBalanceThreshold),
                recentActivityWindowDays: toPositiveNumber(
                    settings.recentActivityWindowDays,
                    defaults.recentActivityWindowDays
                )
            }
        },
        userKpis() {
            const dataset = Array.isArray(this.users) ? this.users : []
            if (!dataset.length) {
                return [
                    {
                        id: "user-data",
                        label: this.loading ? "Sync in progress" : "User data",
                        value: this.loading ? "Loading…" : "No records",
                        hint: this.loading ? "Fetching the latest snapshot" : "Adjust filters or refresh"
                    }
                ]
            }
            const settings = this.kpiSettings
            const cards = []
            const totalBalance = dataset.reduce((sum, user) => sum + (Number(user.money) || 0), 0)
            const avgBalance = dataset.length ? totalBalance / dataset.length : 0
            cards.push({
                id: "avg-balance",
                label: "Avg balance",
                value: formatCurrency(Math.round(avgBalance)),
                hint: "Per indexed user"
            })

            const veteranCount = dataset.reduce((count, user) => {
                const level = Number(user.level)
                return count + (Number.isFinite(level) && level >= settings.veteranLevelThreshold ? 1 : 0)
            }, 0)
            cards.push({
                id: "veterans",
                label: "Veteran players",
                value: `${veteranCount}`,
                hint: `Level ${settings.veteranLevelThreshold}+`
            })

            const highRoller = dataset.reduce(
                (winner, user) => {
                    const balance = Number(user.money) || 0
                    if (!winner || balance > winner.balance) {
                        return {
                            balance,
                            username:
                                user.username
                                || user.displayName
                                || user.tag
                                || (user.id ? `#${user.id}` : "Unknown user")
                        }
                    }
                    return winner
                },
                null
            )
            const meetsVipThreshold = highRoller && highRoller.balance >= settings.vipBalanceThreshold
            cards.push({
                id: "high-roller",
                label: "High roller",
                value: meetsVipThreshold && highRoller ? highRoller.username : "No VIP yet",
                hint: meetsVipThreshold && highRoller
                    ? formatCurrency(highRoller.balance)
                    : `≥ ${formatCurrency(settings.vipBalanceThreshold)}`
            })

            const windowMs = settings.recentActivityWindowDays * 24 * 60 * 60 * 1000
            const now = Date.now()
            const recentCount = dataset.reduce((count, user) => {
                const lastValue = user.last_played !== undefined ? user.last_played : user.lastPlayed
                if (!lastValue) return count
                const timestamp = new Date(lastValue).getTime()
                if (Number.isNaN(timestamp)) return count
                return now - timestamp <= windowMs ? count + 1 : count
            }, 0)
            const recentRatio = dataset.length ? Math.round((recentCount / dataset.length) * 100) : 0
            cards.push({
                id: "recent-activity",
                label: "Recently active",
                value: `${recentRatio}%`,
                hint: `≤ ${settings.recentActivityWindowDays}d`
            })

            const maxCards = settings.maxCards || cards.length
            return cards.slice(0, maxCards)
        },
        activeFilterChips() {
            const chips = []
            const defaults = this.normalizeFilters({})
            const { filtersDraft } = this

            const pushChip = (id, label, keys) => {
                if (!label) return
                chips.push({
                    id,
                    label,
                    keys: Array.isArray(keys) ? keys : [keys]
                })
            }

            if (filtersDraft.search?.trim()) {
                pushChip("search", `Search: ${filtersDraft.search.trim()}`, "search")
            }

            if (filtersDraft.role !== defaults.role) {
                pushChip("role", `Role: ${getRoleLabel(filtersDraft.role)}`, "role")
            }

            const hasLevelMin = filtersDraft.minLevel !== "" && filtersDraft.minLevel !== null
            const hasLevelMax = filtersDraft.maxLevel !== "" && filtersDraft.maxLevel !== null
            if (hasLevelMin || hasLevelMax) {
                let label = "Level"
                if (hasLevelMin) {
                    label += ` ≥ ${filtersDraft.minLevel}`
                }
                if (hasLevelMax) {
                    label += hasLevelMin ? ` · ≤ ${filtersDraft.maxLevel}` : ` ≤ ${filtersDraft.maxLevel}`
                }
                pushChip("level", label, ["minLevel", "maxLevel"])
            }

            const hasBalanceMin = filtersDraft.minBalance !== "" && filtersDraft.minBalance !== null
            const hasBalanceMax = filtersDraft.maxBalance !== "" && filtersDraft.maxBalance !== null
            if (hasBalanceMin || hasBalanceMax) {
                let label = "Balance"
                if (hasBalanceMin) {
                    label += ` ≥ ${Number(filtersDraft.minBalance).toLocaleString()}`
                }
                if (hasBalanceMax) {
                    label += hasBalanceMin ? ` · ≤ ${Number(filtersDraft.maxBalance).toLocaleString()}` : ` ≤ ${Number(filtersDraft.maxBalance).toLocaleString()}`
                }
                pushChip("balance", label, ["minBalance", "maxBalance"])
            }

            if (filtersDraft.activity !== defaults.activity) {
                const activityLabels = {
                    "7d": "Active ≤ 7d",
                    "30d": "Active ≤ 30d",
                    "90d": "Active ≤ 90d"
                }
                pushChip("activity", activityLabels[filtersDraft.activity] || "Recent activity", "activity")
            }

            if (filtersDraft.sortBy !== defaults.sortBy || filtersDraft.sortDirection !== defaults.sortDirection) {
                const sortLabelMap = {
                    last_played: "Last activity",
                    balance: "Balance",
                    level: "Level"
                }
                const direction = filtersDraft.sortDirection === "asc" ? "↑" : "↓"
                pushChip(
                    "sort",
                    `Sort: ${sortLabelMap[filtersDraft.sortBy] || filtersDraft.sortBy} ${direction}`,
                    ["sortBy", "sortDirection"]
                )
            }

            return chips
        },
        advancedFilterCount() {
            return this.activeFilterChips.filter((chip) => chip.id !== "search").length
        },
        filtersButtonTone() {
            if (this.filtersOpen || this.advancedFilterCount) {
                return "chip-icon-btn--active"
            }
            return ""
        },
        filtersButtonAriaLabel() {
            if (this.filtersOpen) {
                return "Hide filters"
            }
            if (this.advancedFilterCount) {
                return `Show filters (${this.advancedFilterCount} active)`
            }
            return "Show filters"
        },
        applyButtonLabel() {
            const count = this.activeFilterChips.length
            return count ? `Apply filters (${count})` : "Apply filters"
        }
    },
    watch: {
        filters: {
            deep: true,
            handler(newValue) {
                const normalized = this.normalizeFilters(newValue)
                this.filtersDraft = normalized
                const advancedActive = this.hasActiveAdvancedFilters(normalized)
                if (!advancedActive) {
                    this.filtersCollapsedManually = false
                }
                if (advancedActive && !this.filtersCollapsedManually) {
                    this.filtersOpen = true
                }
            }
        }
    },
    methods: {
        normalizeFilters(filters = {}) {
            return {
                search: filters.search || "",
                role: filters.role || "all",
                list: filters.list || "all",
                minLevel: filters.minLevel ?? "",
                maxLevel: filters.maxLevel ?? "",
                minBalance: filters.minBalance ?? "",
                maxBalance: filters.maxBalance ?? "",
                activity: filters.activity || "any",
                sortBy: filters.sortBy || "last_played",
                sortDirection: filters.sortDirection || "desc"
            }
        },
        buildPayload() {
            const next = this.normalizeFilters(this.filtersDraft)
            next.search = next.search.trim()
            return next
        },
        toggleFilters() {
            const nextState = !this.filtersOpen
            this.filtersOpen = nextState
            if (!nextState && this.advancedFilterCount > 0) {
                this.filtersCollapsedManually = true
            } else if (nextState) {
                this.filtersCollapsedManually = false
            }
        },
        hasActiveAdvancedFilters(filters = this.filtersDraft) {
            const defaults = this.normalizeFilters({})
            return ADVANCED_FILTER_KEYS.some((key) => filters[key] !== defaults[key])
        },
        clearFilter(keys) {
            const defaults = this.normalizeFilters({})
            const targetKeys = Array.isArray(keys) ? keys : [keys]
            targetKeys.forEach((key) => {
                if (Object.prototype.hasOwnProperty.call(defaults, key)) {
                    this.filtersDraft[key] = defaults[key]
                }
            })
        },
        applyFilters() {
            this.$emit("search", this.buildPayload())
        },
        resetFilters() {
            this.filtersDraft = this.normalizeFilters({})
            this.applyFilters()
        },
        changePage(page) {
            this.$emit("change-page", page)
        },
        refresh() {
            this.$emit("refresh")
        },
        openDetails(id) {
            this.$emit("open-details", id)
        },
        async copyId(id) {
            if (!id) {
                showToast("Unable to copy the ID.")
                return
            }
            try {
                await copyToClipboard(id)
                showToast("User ID copied to clipboard.")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("Unable to copy user id", error)
                showToast("Unable to copy the ID.")
            }
        }
    }
}
</script>
