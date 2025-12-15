<template>
    <div class="chip-section">
        <article v-if="!isAuthenticated" class="chip-card chip-stack gap-4">
            <header class="chip-card__header">
                <div class="chip-stack">
                    <p class="chip-eyebrow">Tables</p>
                    <h2 class="chip-card__title">Active tables</h2>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        Sign in to see active tables.
                    </p>
                </div>
            </header>

            <div class="chip-divider chip-divider--strong my-1"></div>

            <div class="chip-stack items-center gap-3 text-center">
                <p class="chip-notice chip-notice-warning">
                    Please sign in to view tables and live details.
                </p>
                <button type="button" class="chip-btn chip-btn-secondary w-fit" @click="goToLogin">
                    Sign in with Discord
                </button>
            </div>
        </article>

        <ActiveTablesPanel
            v-else
            :tables="tables"
            :loading="tablesLoading"
            :error="tablesError"
            :can-control="canControlTables"
            :busy-table-id="pendingTableAction"
            :fetched-at="tablesFetchedAt"
            @action="handleTableAction"
            @refresh="refreshTables"
        />
    </div>
</template>

<script>
import { mapGetters } from "vuex"
import ActiveTablesPanel from "../logs/components/ActiveTablesPanel.vue"
import api from "../../services/api"
import { rememberPostLoginRoute } from "../../utils/runtime"

export default {
    name: "TablesPage",
    components: {
        ActiveTablesPanel
    },
    data() {
        return {
            tables: [],
            tablesLoading: false,
            tablesError: "",
            tablesInterval: null,
            pendingTableAction: null,
            tablesFetchedAt: ""
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "canViewLogs"]),
        canControlTables() {
            return Boolean(this.canViewLogs)
        }
    },
    async created() {
        if (this.isAuthenticated) {
            await this.bootstrapTables()
        }
    },
    beforeUnmount() {
        this.stopTablesPolling()
    },
    methods: {
        goToLogin() {
            const redirectTarget = this.$route?.fullPath || "/tables"
            rememberPostLoginRoute(redirectTarget)
            this.$router.push({ name: "Login", query: { redirect: redirectTarget } }).catch(() => null)
        },
        async bootstrapTables() {
            await this.loadActiveTables({ showSkeleton: true })
            this.startTablesPolling()
        },
        async refreshTables() {
            if (this.tablesLoading) return
            await this.loadActiveTables({ indicateLoading: true })
        },
        async loadActiveTables({ showSkeleton = false, indicateLoading = false } = {}) {
            if (!this.isAuthenticated) return
            this.tablesError = ""
            const shouldShowSpinner = showSkeleton || indicateLoading
            if (shouldShowSpinner) {
                this.tablesLoading = true
            }
            try {
                const response = await api.getActiveTables()
                this.tables = response?.tables || []
                this.tablesFetchedAt = response?.fetchedAt || new Date().toISOString()
            } catch (error) {
                this.tablesError = error?.response?.data?.message || error.message || "Unable to load tables."
            } finally {
                if (shouldShowSpinner) {
                    this.tablesLoading = false
                }
            }
        },
        startTablesPolling() {
            this.stopTablesPolling()
            this.tablesInterval = setInterval(() => {
                this.loadActiveTables().catch(() => null)
            }, 5000)
        },
        stopTablesPolling() {
            if (this.tablesInterval) {
                clearInterval(this.tablesInterval)
                this.tablesInterval = null
            }
        },
        async handleTableAction({ tableId, action, label }) {
            if (!this.canControlTables || !tableId || !action) return
            const csrfToken = this.$store.state.session.csrfToken
            if (!csrfToken) {
                this.tablesError = "Missing authentication token."
                return
            }
            this.tablesError = ""
            this.pendingTableAction = tableId
            try {
                await api.controlTable({ csrfToken, tableId, action })
                await this.loadActiveTables()
                this.showActionToast(action, label)
            } catch (error) {
                this.tablesError = error?.response?.data?.message || error.message || "Unable to execute the action."
            } finally {
                this.pendingTableAction = null
            }
        },
        showActionToast(action, label) {
            const friendly = {
                start: "Start",
                pause: "Pause",
                resume: "Resume",
                stop: "Stop"
            }
            const target = label || "table"
            const text = `${friendly[action] || action} command sent to ${target}.`
            window.dispatchEvent(new CustomEvent("chipsy-toast", { detail: { message: text } }))
        }
    }
}
</script>
