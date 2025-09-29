<template>
    <div class="chip-card space-y-6">
        <header class="chip-card__header flex-wrap gap-4">
            <div>
                <h3 class="chip-card__title">User stats</h3>
                <p class="chip-card__subtitle">
                    Review the data stored in MySQL to monitor balances and progress.
                </p>
            </div>
            <div class="flex flex-wrap items-center gap-4">
                <div>
                    <p class="chip-label">Quick glimpse</p>
                    <span class="text-base font-semibold text-white">
                        {{ pagination.total || 0 }} users indexed
                    </span>
                </div>
                <div class="chip-segmented" role="group" aria-label="Table density">
                    <button
                        v-for="option in viewOptions"
                        :key="option.value"
                        type="button"
                        class="chip-segmented__option"
                        :class="{ 'chip-segmented__option--active': viewMode === option.value }"
                        @click="setViewMode(option.value)"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
        </header>

        <section class="space-y-4" aria-label="User filters">
            <div class="space-y-3">
                <label class="chip-label flex items-center gap-2">
                    Search
                    <span class="chip-field-hint">Press enter to apply</span>
                </label>
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <input
                        v-model="filtersDraft.search"
                        class="chip-input flex-1"
                        type="search"
                        :placeholder="searchPlaceholder"
                        @keyup.enter="applyFilters"
                    />
                    <div class="chip-segmented" role="group" aria-label="Search mode">
                        <button
                            v-for="option in searchOptions"
                            :key="option.value"
                            type="button"
                            class="chip-segmented__option"
                            :class="{ 'chip-segmented__option--active': filtersDraft.searchField === option.value }"
                            @click="selectSearchField(option.value)"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Role</span>
                    <select v-model="filtersDraft.role" class="chip-input" :style="dropdownSelectStyle">
                        <option value="all">All roles</option>
                        <option value="MASTER">Master</option>
                        <option value="ADMIN">Admin</option>
                        <option value="MODERATOR">Moderator</option>
                        <option value="USER">User</option>
                    </select>
                </label>
                <label class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Access</span>
                    <select v-model="filtersDraft.list" class="chip-input" :style="dropdownSelectStyle">
                        <option value="all">Any</option>
                        <option value="whitelisted">Whitelisted</option>
                        <option value="neutral">Neutral</option>
                        <option value="blacklisted">Blacklisted</option>
                    </select>
                </label>
                <div class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Level range</span>
                    <div class="flex items-center gap-2">
                        <input v-model="filtersDraft.minLevel" class="chip-input" type="number" min="0" placeholder="Min" />
                        <span class="text-slate-500">—</span>
                        <input v-model="filtersDraft.maxLevel" class="chip-input" type="number" min="0" placeholder="Max" />
                    </div>
                </div>
                <div class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Balance range</span>
                    <div class="flex items-center gap-2">
                        <input v-model="filtersDraft.minBalance" class="chip-input" type="number" min="0" placeholder="Min" />
                        <span class="text-slate-500">—</span>
                        <input v-model="filtersDraft.maxBalance" class="chip-input" type="number" min="0" placeholder="Max" />
                    </div>
                </div>
                <label class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Activity</span>
                    <select v-model="filtersDraft.activity" class="chip-input" :style="dropdownSelectStyle">
                        <option value="any">Any time</option>
                        <option value="7d">Last 7 days</option>
                        <option value="30d">Last 30 days</option>
                        <option value="90d">Last 90 days</option>
                    </select>
                </label>
                <div class="flex flex-col gap-2 text-sm text-slate-200">
                    <span class="chip-label">Sort by</span>
                    <div class="flex items-center gap-2">
                        <select v-model="filtersDraft.sortBy" class="chip-input flex-1" :style="dropdownSelectStyle">
                            <option value="last_played">Last played</option>
                            <option value="balance">Balance</option>
                            <option value="level">Level</option>
                        </select>
                        <button
                            class="chip-btn chip-btn-ghost px-3 py-2"
                            type="button"
                            :aria-label="sortDirectionLabel"
                            @click="toggleSortDirection"
                        >
                            <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
                                <path
                                    v-if="filtersDraft.sortDirection === 'desc'"
                                    d="M12 6l6 6H6z"
                                    fill="currentColor"
                                />
                                <path
                                    v-else
                                    d="M12 18l-6-6h12z"
                                    fill="currentColor"
                                />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-3" aria-live="polite">
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
                <div class="flex flex-wrap gap-2">
                    <button
                        class="chip-btn chip-btn-secondary"
                        type="button"
                        :disabled="loading"
                        @click="applyFilters"
                    >
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
                    <button class="chip-btn chip-btn-ghost" type="button" :disabled="loading" @click="refresh">
                        Refresh
                    </button>
                </div>
            </div>
        </section>

        <div class="overflow-x-auto rounded-3xl border border-white/10 bg-white/5">
            <table class="chip-table" :class="{ 'text-xs': isCompactView }">
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
                            <div class="flex flex-col">
                                <span class="font-semibold text-white">{{ user.username }}</span>
                                <span v-if="user.tag" class="text-xs text-slate-400">{{ user.tag }}</span>
                            </div>
                        </td>
                        <td class="font-mono text-sm text-slate-300">
                            {{ user.id }}
                        </td>
                        <td>
                            <span class="chip-pill" :class="user.roleClass">
                                {{ user.roleLabel }}
                            </span>
                        </td>
                        <td class="font-semibold text-white">{{ user.balance }}</td>
                        <td>
                            <div class="flex flex-col">
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
                                    Copy
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
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
            <span v-if="pagination.total">
                {{ pagination.total }} users
            </span>
            <div class="flex flex-wrap items-center gap-2">
                <button
                    class="chip-btn chip-btn-ghost px-4 py-2"
                    :disabled="loading || pagination.page <= 1"
                    @click="changePage(pagination.page - 1)"
                >
                    ← Previous
                </button>
                <span class="text-slate-200">
                    Page {{ pagination.page }} of {{ pagination.totalPages }}
                </span>
                <button
                    class="chip-btn chip-btn-ghost px-4 py-2"
                    :disabled="loading || pagination.page >= pagination.totalPages"
                    @click="changePage(pagination.page + 1)"
                >
                    Next →
                </button>
            </div>
        </div>
    </div>
</template>

<script>
import { formatCurrency, formatPercentage, formatExpRange, formatFriendlyDateTime } from "../../../utils/formatters"
import { getRoleLabel } from "../../../constants/roles"
import { showToast } from "../../../utils/toast"
import { copyToClipboard } from "../../../utils/clipboard"
import { PANEL_DEFAULTS } from "../../../config/panelDefaults"

const VIEW_MODES = [
    { label: "Comfort", value: "comfortable" },
    { label: "Compact", value: "compact" }
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
        return {
            filtersDraft: this.normalizeFilters(this.filters),
            viewMode: "comfortable"
        }
    },
    computed: {
        searchOptions() {
            return [
                { label: "IDs", value: "id" },
                { label: "Names", value: "username" }
            ]
        },
        normalizedFilters() {
            return this.normalizeFilters(this.filters)
        },
        hasChanges() {
            const keys = Object.keys(this.filtersDraft)
            return keys.some((key) => this.filtersDraft[key] !== this.normalizedFilters[key])
        },
        searchPlaceholder() {
            return this.filtersDraft.searchField === "username"
                ? "Search by username, tag, or nickname…"
                : "Search by user ID…"
        },
        sortDirectionLabel() {
            return this.filtersDraft.sortDirection === "desc" ? "Sorted descending" : "Sorted ascending"
        },
        formattedUsers() {
            return this.users.map((user) => {
                const rawUsername = user.username || "N/A"
                let tag = user.tag || null
                let baseName = rawUsername
                if (!tag && rawUsername.includes("#")) {
                    const [namePart, discriminator] = rawUsername.split("#")
                    if (namePart) baseName = namePart
                    if (discriminator) tag = `#${discriminator}`
                }
                const roleKey = (user.panelRole || user.access?.role || "USER").toLowerCase()
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
                    roleClass: `chip-role-${roleKey}`
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
        viewOptions() {
            return VIEW_MODES
        },
        isCompactView() {
            return this.viewMode === "compact"
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

            if (filtersDraft.list !== defaults.list) {
                const listLabels = {
                    whitelisted: "Whitelisted",
                    blacklisted: "Blacklisted",
                    neutral: "Neutral"
                }
                pushChip("list", `Access: ${listLabels[filtersDraft.list] || filtersDraft.list}`, "list")
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
        applyButtonLabel() {
            const count = this.activeFilterChips.length
            return count ? `Apply filters (${count})` : "Apply filters"
        }
    },
    watch: {
        filters: {
            deep: true,
            handler(newValue) {
                this.filtersDraft = this.normalizeFilters(newValue)
            }
        }
    },
    methods: {
        normalizeFilters(filters = {}) {
            return {
                search: filters.search || "",
                searchField: filters.searchField || "id",
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
        selectSearchField(field) {
            this.filtersDraft.searchField = field
        },
        setViewMode(mode) {
            if (!VIEW_MODES.some((option) => option.value === mode)) return
            this.viewMode = mode
        },
        toggleSortDirection() {
            this.filtersDraft.sortDirection = this.filtersDraft.sortDirection === "desc" ? "asc" : "desc"
        },
        buildPayload() {
            const next = this.normalizeFilters(this.filtersDraft)
            next.search = next.search.trim()
            return next
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
