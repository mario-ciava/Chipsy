<template>
    <div class="card card--wide user-table-card" :style="dropdownStyleVars">
        <div class="card__header card__header--split">
            <div>
                <h3 class="card__title">User stats</h3>
                <p class="card__subtitle">
                    Review the data stored in MySQL to monitor balances and progress.
                </p>
            </div>
            <div class="user-table__summary">
                <div>
                    <p class="user-table__summary-label">Quick glimpse</p>
                    <span class="user-table__summary-value">
                        {{ pagination.total || 0 }} users indexed
                    </span>
                </div>
                <div class="user-table__view-toggle" role="group" aria-label="Table density">
                    <button
                        v-for="option in viewOptions"
                        :key="option.value"
                        type="button"
                        class="user-table__view-button"
                        :class="{ 'user-table__view-button--active': viewMode === option.value }"
                        @click="setViewMode(option.value)"
                    >
                        {{ option.label }}
                    </button>
                </div>
            </div>
        </div>

        <section class="user-table__filters" aria-label="User filters">
            <div class="user-table__search-group">
                <label class="user-table__label">
                    Search
                    <span class="user-table__hint">Press enter to apply</span>
                </label>
                <div class="user-table__search-row">
                    <input
                        v-model="filtersDraft.search"
                        class="user-table__search-input"
                        type="search"
                        :placeholder="searchPlaceholder"
                        @keyup.enter="applyFilters"
                    />
                    <div class="segmented-control" role="group" aria-label="Search mode">
                        <button
                            v-for="option in searchOptions"
                            :key="option.value"
                            type="button"
                            class="segmented-control__option"
                            :class="{ 'segmented-control__option--active': filtersDraft.searchField === option.value }"
                            :aria-pressed="filtersDraft.searchField === option.value"
                            @click="selectSearchField(option.value)"
                        >
                            {{ option.label }}
                        </button>
                    </div>
                </div>
            </div>

            <div class="user-table__filter-divider" aria-hidden="true"></div>

            <div class="user-table__grid">
                <label class="user-table__control">
                    <span class="user-table__label">Role</span>
                    <select v-model="filtersDraft.role">
                        <option value="all">All roles</option>
                        <option value="MASTER">Master</option>
                        <option value="ADMIN">Admin</option>
                        <option value="MODERATOR">Moderator</option>
                        <option value="USER">User</option>
                    </select>
                </label>
                <label class="user-table__control">
                    <span class="user-table__label">Access</span>
                    <select v-model="filtersDraft.list">
                        <option value="all">Any</option>
                        <option value="whitelisted">Whitelisted</option>
                        <option value="neutral">Neutral</option>
                        <option value="blacklisted">Blacklisted</option>
                    </select>
                </label>
                <div class="user-table__range">
                    <span class="user-table__label">Level range</span>
                    <div class="user-table__range-inputs">
                        <input v-model="filtersDraft.minLevel" type="number" min="0" placeholder="Min" />
                        <span class="user-table__range-sep">—</span>
                        <input v-model="filtersDraft.maxLevel" type="number" min="0" placeholder="Max" />
                    </div>
                </div>
                <div class="user-table__range">
                    <span class="user-table__label">Balance range</span>
                    <div class="user-table__range-inputs">
                        <input v-model="filtersDraft.minBalance" type="number" min="0" placeholder="Min" />
                        <span class="user-table__range-sep">—</span>
                        <input v-model="filtersDraft.maxBalance" type="number" min="0" placeholder="Max" />
                    </div>
                </div>
                <label class="user-table__control">
                    <span class="user-table__label">Activity</span>
                    <select v-model="filtersDraft.activity">
                        <option value="any">Any time</option>
                        <option value="7d">Active last 7 days</option>
                        <option value="30d">Active last 30 days</option>
                        <option value="90d">Active last 90 days</option>
                    </select>
                </label>
                <div class="user-table__sort">
                    <span class="user-table__label">Order by</span>
                    <div class="user-table__sort-controls">
                        <select v-model="filtersDraft.sortBy">
                            <option value="last_played">Last activity</option>
                            <option value="balance">Balance</option>
                            <option value="level">Level</option>
                        </select>
                        <button
                            type="button"
                            class="user-table__sort-direction"
                            :aria-label="sortDirectionLabel"
                            @click="toggleSortDirection"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
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

            <div v-if="activeFilterChips.length" class="user-table__chips" aria-live="polite">
                <button
                    v-for="chip in activeFilterChips"
                    :key="chip.id"
                    type="button"
                    class="user-table__chip"
                    @click="clearFilter(chip.keys)"
                >
                    <span>{{ chip.label }}</span>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                            d="M4 4l8 8m0-8l-8 8"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                        />
                    </svg>
                </button>
            </div>

            <div class="user-table__actions">
                <button
                    class="button button--secondary"
                    type="button"
                    :disabled="loading"
                    @click="applyFilters"
                >
                    <span v-if="loading" class="button__spinner"></span>
                    <span v-else>{{ applyButtonLabel }}</span>
                </button>
                <button
                    class="button button--ghost"
                    type="button"
                    :disabled="loading || !hasChanges"
                    @click="resetFilters"
                >
                    Reset
                </button>
                <button class="button button--ghost" type="button" :disabled="loading" @click="refresh">
                    Refresh
                </button>
            </div>
        </section>

        <div class="card__body card__body--overflow">
            <table class="data-table" :class="{ 'data-table--compact': isCompactView }">
                <thead>
                    <tr>
                        <th>User</th>
                        <th>ID</th>
                        <th>Role</th>
                        <th>Balance</th>
                        <th>Level</th>
                        <th>Last activity</th>
                        <th class="table-actions-column">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-if="loading">
                        <td colspan="7" class="data-table__loading">Loading data…</td>
                    </tr>
                    <tr v-else-if="!formattedUsers.length">
                        <td colspan="7" class="data-table__empty">
                            No users match the current filters.
                        </td>
                    </tr>
                    <tr v-else v-for="user in formattedUsers" :key="user.id">
                        <td>
                            <div class="user-table__name">
                                <div class="user-table__name-meta">
                                    <span class="user-table__username">{{ user.username }}</span>
                                    <span v-if="user.tag" class="user-table__tag">{{ user.tag }}</span>
                                </div>
                            </div>
                        </td>
                        <td class="data-table__cell data-table__cell--mono">
                            <span class="user-table__id-value">{{ user.id }}</span>
                        </td>
                        <td>
                            <span class="role-pill" :class="user.roleClass">
                                {{ user.roleLabel }}
                            </span>
                        </td>
                        <td>{{ user.balance }}</td>
                        <td>
                            <span class="data-table__accent">{{ user.level }}</span>
                            <small class="data-table__meta">{{ user.exp }}</small>
                        </td>
                        <td>{{ user.lastPlayed }}</td>
                        <td class="table-actions">
                            <button
                                type="button"
                                class="button button--ghost button--icon user-table__copy"
                                title="Copy ID"
                                @click="copyId(user.id)"
                            >
                                <svg viewBox="0 0 20 20" aria-hidden="true">
                                    <rect x="6" y="6" width="9" height="9" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5" />
                                    <rect x="3" y="3" width="9" height="9" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5" />
                                </svg>
                                <span class="sr-only">Copy ID</span>
                            </button>
                            <button
                                type="button"
                                class="button button--ghost data-table__details"
                                @click="openDetails(user.id)"
                            >
                                Details
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="card__footer pagination">
            <span class="pagination__count" v-if="pagination.total">
                {{ pagination.total }} users
            </span>
            <div class="pagination__controls">
                <button
                    class="button button--ghost"
                    :disabled="loading || pagination.page <= 1"
                    @click="changePage(pagination.page - 1)"
                >
                    ← Previous
                </button>
                <span class="pagination__info">
                    Page {{ pagination.page }} of {{ pagination.totalPages }}
                </span>
                <button
                    class="button button--ghost"
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
                    roleClass: `role-pill--${(user.panelRole || user.access?.role || "USER").toLowerCase()}`
                }
            })
        },
        panelDropdownTheme() {
            const config = this.$store?.getters?.["session/panelConfig"]
            return config?.dropdown || PANEL_DEFAULTS.dropdown
        },
        dropdownStyleVars() {
            const theme = this.panelDropdownTheme
            return {
                "--dropdown-bg": theme.background,
                "--dropdown-border": theme.border,
                "--dropdown-option-hover": theme.optionHover,
                "--dropdown-option-active": theme.optionActive,
                "--dropdown-option-text": theme.optionText
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

<style scoped>
.user-table-card {
    gap: 20px;
    --dropdown-bg: rgba(15, 23, 42, 0.85);
    --dropdown-border: rgba(148, 163, 184, 0.3);
    --dropdown-option-hover: rgba(99, 102, 241, 0.25);
    --dropdown-option-active: rgba(124, 58, 237, 0.35);
    --dropdown-option-text: var(--fg-primary);
}

.user-table__summary {
    text-align: right;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px 16px;
    align-items: center;
}

.user-table__summary-label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--fg-muted);
}

.user-table__summary-value {
    font-weight: 600;
    font-size: 1rem;
}

.user-table__view-toggle {
    display: inline-flex;
    background: rgba(148, 163, 184, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 999px;
    padding: 3px;
    gap: 2px;
}

.user-table__view-button {
    border: none;
    background: transparent;
    color: rgba(226, 232, 240, 0.75);
    font-size: 0.8rem;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.user-table__view-button--active {
    background: rgba(99, 102, 241, 0.2);
    color: #f8fafc;
    box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.35);
}

.user-table__filters {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 0;
}

.user-table__search-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 12px;
}

.user-table__label {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
    display: inline-flex;
    gap: 6px;
    align-items: center;
}

.user-table__hint {
    color: rgba(226, 232, 240, 0.65);
    font-size: 0.75rem;
    text-transform: none;
    letter-spacing: normal;
}

.user-table__search-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.user-table__search-input {
    flex: 1 1 260px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    border: 1px solid rgba(148, 163, 184, 0.35);
    background: rgba(15, 23, 42, 0.85);
    color: var(--fg-primary);
    min-width: 220px;
}

.user-table__search-input:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
}

.segmented-control {
    display: inline-flex;
    background: rgba(148, 163, 184, 0.1);
    border-radius: var(--radius-full, 999px);
    padding: 4px;
    border: 1px solid rgba(148, 163, 184, 0.2);
}

.segmented-control__option {
    border: none;
    background: transparent;
    color: var(--fg-muted);
    padding: 6px 14px;
    border-radius: var(--radius-full, 999px);
    cursor: pointer;
    transition: background var(--transition-fast), color var(--transition-fast);
}

.segmented-control__option--active {
    background: rgba(124, 58, 237, 0.2);
    color: var(--fg-primary);
}

.user-table__filter-divider {
    height: 1px;
    width: 100%;
    background: linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.45), transparent);
}

.user-table__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
}

.user-table__control,
.user-table__range,
.user-table__sort {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.user-table__control select,
.user-table__range input,
.user-table__sort select {
    width: 100%;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--dropdown-border, rgba(148, 163, 184, 0.3));
    background: var(--dropdown-bg, rgba(15, 23, 42, 0.85));
    color: var(--dropdown-option-text, var(--fg-primary));
    transition: border var(--transition-fast), box-shadow var(--transition-fast);
}

.user-table__control select:focus-visible,
.user-table__sort select:focus-visible {
    outline: none;
    border-color: rgba(99, 102, 241, 0.7);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
}

.user-table__control select,
.user-table__sort select {
    appearance: none;
    background-image:
        linear-gradient(45deg, transparent 50%, rgba(148, 163, 184, 0.8) 50%),
        linear-gradient(135deg, rgba(148, 163, 184, 0.8) 50%, transparent 50%),
        linear-gradient(to right, rgba(148, 163, 184, 0.2), rgba(148, 163, 184, 0.2));
    background-position:
        calc(100% - 18px) center,
        calc(100% - 12px) center,
        calc(100% - 2.4em) center;
    background-size: 6px 6px, 6px 6px, 1px 60%;
    background-repeat: no-repeat;
    padding-right: 40px;
}

.user-table__control select option,
.user-table__sort select option {
    background: var(--dropdown-bg, rgba(15, 23, 42, 0.9));
    color: var(--dropdown-option-text, var(--fg-primary));
}

.user-table__control select option:hover,
.user-table__sort select option:hover {
    background: var(--dropdown-option-hover, rgba(99, 102, 241, 0.25));
}

.user-table__control select option:checked,
.user-table__sort select option:checked {
    background: var(--dropdown-option-active, rgba(124, 58, 237, 0.35));
}

.user-table__range-inputs {
    display: flex;
    align-items: center;
    gap: 8px;
}

.user-table__range-sep {
    color: var(--fg-muted);
    font-size: 0.85rem;
}

.user-table__sort-controls {
    display: flex;
    align-items: center;
    gap: 8px;
}

.user-table__sort-direction {
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.8);
    width: 42px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
}

.user-table__sort-direction svg {
    width: 20px;
    height: 20px;
}

.user-table__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: flex-end;
}

.user-table__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: -4px;
}

.user-table__chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.12);
    color: var(--fg-primary);
    font-size: 0.8rem;
    padding: 4px 10px 4px 14px;
    cursor: pointer;
    transition: border var(--transition-fast), background var(--transition-fast), transform var(--transition-fast);
}

.user-table__chip:hover {
    border-color: rgba(124, 58, 237, 0.45);
    background: rgba(124, 58, 237, 0.15);
    transform: translateY(-1px);
}

.user-table__chip svg {
    width: 12px;
    height: 12px;
}

@media (max-width: 720px) {
    .user-table__summary {
        justify-content: space-between;
        text-align: left;
    }

    .user-table__view-toggle {
        align-self: stretch;
        justify-content: space-between;
    }

    .user-table__search-row {
        flex-direction: column;
    }

    .user-table__actions {
        justify-content: flex-start;
    }
}
</style>
