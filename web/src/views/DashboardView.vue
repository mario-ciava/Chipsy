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

        <transition name="fade">
            <div
                v-if="flashMessage"
                class="dashboard__notice"
                :class="`dashboard__notice--${flashMessage.type}`"
            >
                {{ flashMessage.message }}
            </div>
        </transition>

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
            statusInterval: null,
            flashMessage: null,
            flashTimeout: null
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
        })
    },
    async created() {
        if (!this.isAuthenticated) {
            this.$router.replace({ name: "Login" })
            return
        }
        await this.initialize()
        await this.handleInviteRedirect()
    },
    beforeDestroy() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval)
            this.statusInterval = null
        }
        if (this.flashTimeout) {
            clearTimeout(this.flashTimeout)
            this.flashTimeout = null
        }
    },
    methods: {
        setFlash(message, type = "info") {
            if (this.flashTimeout) {
                clearTimeout(this.flashTimeout)
                this.flashTimeout = null
            }
            if (!message) {
                this.flashMessage = null
                return
            }
            this.flashMessage = { message, type }
            this.flashTimeout = setTimeout(() => {
                this.flashMessage = null
                this.flashTimeout = null
            }, 5000)
        },
        async waitForGuildJoin(guildId) {
            if (guildId && this.guilds.added.some((guild) => guild.id === guildId)) {
                return true
            }
            const maxAttempts = guildId ? 5 : 3
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await this.loadGuilds()
                if (!guildId) {
                    return true
                }
                if (this.guilds.added.some((guild) => guild.id === guildId)) {
                    return true
                }
                await new Promise((resolve) => setTimeout(resolve, 1500))
            }
            return false
        },
        async handleInviteRedirect() {
            if (this.$route.query.state !== "controlPanelInvite") return
            const guildId = this.$route.query.guild_id || null
            const code = this.$route.query.code || null
            const csrfToken = this.$store.state.session.csrfToken

            if (code) {
                if (!csrfToken) {
                    this.setFlash("Sessione non valida. Effettua di nuovo il login e ripeti l'invito.", "warning")
                    this.$router.replace({ path: "/control_panel" }).catch(() => {})
                    return
                }
                try {
                    await api.completeInvite({ csrfToken, code, guildId })
                } catch (error) {
                    // eslint-disable-next-line no-console
                    console.error("Failed to finalize invite", error)
                    this.setFlash("Non è stato possibile completare l'invito. Riprova più tardi.", "warning")
                    this.$router.replace({ path: "/control_panel" }).catch(() => {})
                    return
                }
            }

            const joined = await this.waitForGuildJoin(guildId)
            if (joined) {
                this.$store.dispatch("bot/fetchStatus").catch(() => null)
                this.setFlash("Chipsy è stato aggiunto al server selezionato.", "success")
            } else if (guildId) {
                this.setFlash("Invito completato. Discord sta ancora elaborando l'ingresso del bot, riprova tra qualche secondo.", "warning")
            } else {
                this.setFlash("Invito completato. Aggiorna l'elenco per verificare i server attivi.")
            }
            this.$router.replace({ path: "/control_panel" }).catch(() => {})
        },
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
            if (!this.isAuthenticated) return
            try {
                const guilds = await api.getGuilds()
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
            if (!this.isAuthenticated) return
            try {
                const response = await api.getAdminActions()
                this.actions = response.actions || []
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load remote actions", error)
            }
        },
        async toggleBot(enabled) {
            try {
                await this.$store.dispatch("bot/updateEnabled", enabled)
                this.setFlash(`Bot ${enabled ? 'acceso' : 'spento'} con successo.`, "success")
            } catch (error) {
                if (error.code === 409) {
                    this.setFlash(error.message, "warning")
                } else {
                    this.setFlash("Non è stato possibile aggiornare lo stato del bot.", "warning")
                }
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
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication context")
                }
                await api.leaveGuild({ csrfToken, guildId: id })
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

.dashboard__notice {
    margin: 16px 0;
    padding: 14px 18px;
    border-radius: 12px;
    font-weight: 500;
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
}

.dashboard__notice--success {
    background: rgba(74, 222, 128, 0.2);
    color: #bbf7d0;
}

.dashboard__notice--warning {
    background: rgba(250, 204, 21, 0.2);
    color: #fef08a;
}
</style>
