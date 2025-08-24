<template>
    <div class="dashboard">
        <header class="dashboard__header">
            <div>
                <h1 class="dashboard__title">Pannello di controllo</h1>
                <p class="dashboard__subtitle">
                    Gestisci il bot, monitora i server connessi e osserva i dati provenienti dal database MySQL.
                </p>
            </div>
            <div class="dashboard__meta" v-if="user">
                <span class="dashboard__meta-label">Amministratore:</span>
                <span class="dashboard__meta-value">{{ user.username }}</span>
            </div>
        </header>

        <section class="dashboard__grid">
            <BotStatusCard
                :status="botStatus"
                :loading="botLoading"
                @toggle="toggleBot"
            />
            <GuildOverview :guilds="guilds" @leave="leaveGuild" />
            <RemoteActions :actions="actions" />
        </section>

        <section class="dashboard__section">
            <UserTable
                :users="users"
                :pagination="pagination"
                :loading="usersLoading"
                :search="usersSearch"
                @search="handleSearch"
                @change-page="handlePageChange"
                @refresh="refreshUsers"
                @open-details="openUserDetails"
            />
        </section>

        <p v-if="errorMessage" class="dashboard__error">
            {{ errorMessage }}
        </p>
    </div>
</template>

<script>
import { mapGetters, mapState } from "vuex"
import BotStatusCard from "../components/dashboard/BotStatusCard.vue"
import GuildOverview from "../components/dashboard/GuildOverview.vue"
import RemoteActions from "../components/dashboard/RemoteActions.vue"
import UserTable from "../components/dashboard/UserTable.vue"
import api from "../services/api"

export default {
    name: "DashboardView",
    components: {
        BotStatusCard,
        GuildOverview,
        RemoteActions,
        UserTable
    },
    data() {
        return {
            guilds: {
                added: [],
                available: []
            },
            actions: [],
            errorMessage: null,
            statusInterval: null
        }
    },
    computed: {
        ...mapGetters("session", ["user", "isAuthenticated"]),
        ...mapState("bot", {
            botStatus: (state) => state.status || {},
            botLoading: (state) => state.loading
        }),
        ...mapState("users", {
            users: (state) => state.items,
            pagination: (state) => state.pagination,
            usersLoading: (state) => state.loading,
            usersSearch: (state) => state.search
        }),
        token() {
            return this.$store.state.session.token
        }
    },
    async created() {
        if (!this.isAuthenticated) {
            this.$router.replace({ name: "Login" })
            return
        }
        await this.initialize()
    },
    beforeDestroy() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval)
            this.statusInterval = null
        }
    },
    methods: {
        async initialize() {
            this.errorMessage = null
            try {
                await this.$store.dispatch("bot/fetchStatus")
            } catch (error) {
                this.errorMessage = "Impossibile recuperare lo stato del bot."
                // eslint-disable-next-line no-console
                console.error(error)
            }

            await Promise.all([
                this.loadGuilds(),
                this.loadActions(),
                this.refreshUsers()
            ])

            if (this.statusInterval) {
                clearInterval(this.statusInterval)
            }
            this.statusInterval = setInterval(() => {
                this.$store.dispatch("bot/fetchStatus").catch(() => null)
            }, 30000)
        },
        async loadGuilds() {
            if (!this.token) return
            try {
                const guilds = await api.getGuilds(this.token)
                const added = Array.isArray(guilds.added) ? guilds.added : []
                const availableRaw = Array.isArray(guilds.available) ? guilds.available : []
                const addedIds = new Set(added.map((guild) => guild.id))
                const available = availableRaw.filter((guild) => !addedIds.has(guild.id))

                this.guilds = {
                    added,
                    available
                }
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load guilds", error)
            }
        },
        async loadActions() {
            if (!this.token) return
            try {
                const response = await api.getAdminActions(this.token)
                this.actions = response.actions || []
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load remote actions", error)
            }
        },
        async toggleBot(enabled) {
            try {
                await this.$store.dispatch("bot/updateEnabled", enabled)
            } catch (error) {
                this.errorMessage = "Non è stato possibile aggiornare lo stato del bot."
                // eslint-disable-next-line no-console
                console.error("Toggle bot failed", error)
            }
        },
        async handleSearch(value) {
            try {
                await this.$store.dispatch("users/fetchUsers", {
                    page: 1,
                    search: value
                })
            } catch (error) {
                this.errorMessage = "Errore durante la ricerca degli utenti."
                // eslint-disable-next-line no-console
                console.error("User search failed", error)
            }
        },
        async handlePageChange(page) {
            try {
                await this.$store.dispatch("users/fetchUsers", {
                    page
                })
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Pagination change failed", error)
            }
        },
        async refreshUsers() {
            try {
                await this.$store.dispatch("users/refresh")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Refresh users failed", error)
            }
        },
        async leaveGuild(id) {
            try {
                const token = this.$store.state.session.token
                const csrfToken = this.$store.state.session.csrfToken
                if (!token || !csrfToken) {
                    throw new Error("Missing authentication context")
                }
                await api.leaveGuild({ token, csrfToken, guildId: id })
                await this.loadGuilds()
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to leave guild", error)
                this.errorMessage = "Impossibile far uscire il bot dal server selezionato."
            }
        },
        openUserDetails(id) {
            this.$router.push({ name: "UserDetail", params: { id } })
        }
    }
}
</script>

<style scoped>
.dashboard__meta-value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
</style>
