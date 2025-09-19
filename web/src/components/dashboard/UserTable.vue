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
                        <th>ID</th>
                        <th>User</th>
                        <th>Balance</th>
                        <th>Level</th>
                        <th>Win rate</th>
                        <th>Biggest win</th>
                        <th>Last activity</th>
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
                        <td class="data-table__cell data-table__cell--mono">
                            <div class="user-table__id">
                                <button
                                    type="button"
                                    class="button button--ghost user-table__copy"
                                    title="Copy ID"
                                    @click="copyId(user.id)"
                                >
                                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                        <path d="M8 2a2 2 0 00-2 2v9h1V4a1 1 0 011-1h8a1 1 0 011 1v10a1 1 0 01-1 1H9v1h8a2 2 0 002-2V4a2 2 0 00-2-2H8z" />
                                        <path d="M3 6a2 2 0 012-2h6a2 2 0 012 2v11a1 1 0 01-1 1H4a1 1 0 01-1-1V6z" />
                                    </svg>
                                </button>
                                <span>{{ user.id }}</span>
                                <button
                                    type="button"
                                    class="button button--ghost data-table__details"
                                    @click="openDetails(user.id)"
                                >
                                    Details
                                </button>
                            </div>
                        </td>
                        <td>{{ user.username }}</td>
                        <td>{{ user.balance }}</td>
                        <td>
                            <span class="data-table__accent">{{ user.level }}</span>
                            <small class="data-table__meta">{{ user.exp }}</small>
                        </td>
                        <td>{{ user.winRate }}</td>
                        <td>{{ user.biggestWon }}</td>
                        <td>{{ user.lastPlayed }}</td>
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
const formatCurrency = (value) => {
    const amount = Number(value) || 0
    return `${amount.toLocaleString("en-US")} $`
}

const formatPercentage = (value) => `${Number(value || 0).toFixed(2)} %`

const formatExp = (current, required) => `${current.toLocaleString("en-US")} / ${required.toLocaleString("en-US")}`

const formatDate = (value) => {
    if (!value) return "N/A"
    try {
        const formatter = new Intl.DateTimeFormat("en-US", {
            dateStyle: "short",
            timeStyle: "short"
        })
        return formatter.format(new Date(value))
    } catch (_error) {
        return "N/A"
    }
}

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
            return this.users.map((user) => ({
                id: user.id,
                balance: formatCurrency(user.money),
                level: user.level,
                exp: formatExp(
                    Number(user.current_exp !== undefined ? user.current_exp : user.currentExp),
                    Number(user.required_exp !== undefined ? user.required_exp : user.requiredExp)
                ),
                winRate: formatPercentage(user.winRate),
                biggestWon: formatCurrency(user.biggest_won !== undefined ? user.biggest_won : user.biggestWon),
                lastPlayed: formatDate(user.last_played !== undefined ? user.last_played : user.lastPlayed),
                username: user.username || "N/A"
            }))
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
            } catch (error) {
                // eslint-disable-next-line no-console
                console.warn("Unable to copy user id", error)
            }
        }
    }
}
</script>
