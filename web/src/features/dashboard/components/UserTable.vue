<template>
    <div class="card card--wide">
        <div class="card__header card__header--split">
            <div>
                <h3 class="card__title">User stats</h3>
                <p class="card__subtitle">
                    Review the data stored in MySQL to monitor balances and progress.
                </p>
            </div>
            <div class="table-controls">
                <input
                    v-model="searchTerm"
                    class="table-controls__input"
                    type="search"
                    placeholder="Search by user ID…"
                    @keyup.enter="emitSearch"
                />
                <button class="button button--secondary" @click="emitSearch" :disabled="loading">
                    Search
                </button>
                <button class="button button--ghost" @click="refresh" :disabled="loading">
                    Refresh
                </button>
            </div>
        </div>

        <div class="card__body card__body--overflow">
            <table class="data-table">
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
        search: {
            type: String,
            default: ""
        },
        loading: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            searchTerm: this.search
        }
    },
    computed: {
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
        }
    },
    watch: {
        search(newValue) {
            if (newValue !== this.searchTerm) {
                this.searchTerm = newValue
            }
        }
    },
    methods: {
        emitSearch() {
            this.$emit("search", this.searchTerm.trim())
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
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(id)
                }
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
