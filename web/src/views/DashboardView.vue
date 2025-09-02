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
                :cooldown-active="cooldown.active"
                :cooldown-target="cooldown.target"
                :cooldown-remaining="cooldown.remaining"
                :cooldown-duration="cooldown.duration"
                :kill-loading="botKillPending"
                @toggle="toggleBot"
                @kill="handleKillRequest"
            />
            <GuildOverview :guilds="guilds" @leave="leaveGuild" />
            <RemoteActions
                :actions="actions"
                @action-success="handleActionSuccess"
                @action-error="handleActionError"
            />
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
import { mapActions, mapGetters, mapState } from "vuex"
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
            flashTimeout: null,
            cooldown: {
                active: false,
                target: null,
                duration: 15000,
                remaining: 0
            },
            cooldownInterval: null,
            cooldownStart: null,
            lastStatusEnabled: null,
            lastStatusUpdatedAt: null,
            botKillPending: false
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
    watch: {
        botStatus: {
            deep: true,
            handler(newStatus) {
                if (!newStatus || typeof newStatus.enabled !== "boolean") return
                const updatedAt = newStatus.updatedAt || null
                if (this.lastStatusEnabled === null) {
                    this.lastStatusEnabled = newStatus.enabled
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("info", `Stato iniziale: bot ${newStatus.enabled ? "online" : "offline"}.`)
                    return
                }
                const statusChanged = this.lastStatusEnabled !== newStatus.enabled
                const timestampChanged = updatedAt && this.lastStatusUpdatedAt !== updatedAt
                if (statusChanged) {
                    this.lastStatusEnabled = newStatus.enabled
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("success", `Il bot è ora ${newStatus.enabled ? "online" : "offline"}.`)
                } else if (timestampChanged) {
                    this.lastStatusUpdatedAt = updatedAt
                    this.pushLog("debug", "Aggiornamento stato completato senza variazioni.")
                }
            }
        }
    },
    async created() {
        if (!this.isAuthenticated) {
            this.$router.replace({ name: "Login" })
            return
        }
        this.pushLog("system", "Dashboard caricata. Avvio sincronizzazione dati…")
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
        this.cancelCooldown({ silent: true })
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
                this.pushLog("error", "Recupero stato bot fallito.")
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
                this.$store.dispatch("bot/fetchStatus").catch(() => {
                    this.pushLog("warning", "Aggiornamento automatico dello stato non riuscito.")
                })
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
                this.pushLog("warning", "Impossibile aggiornare l'elenco server.")
            }
        },
        async loadActions() {
            if (!this.isAuthenticated) return
            try {
                const response = await api.getAdminActions()
                this.actions = response.actions || []
                this.pushLog("info", `Azioni remote disponibili: ${this.actions.length}.`)
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to load remote actions", error)
                this.pushLog("warning", "Impossibile aggiornare le azioni remote.")
            }
        },
        async toggleBot(enabled) {
            const target = enabled ? "disable" : "enable"
            this.pushLog("info", `Richiesta di ${enabled ? "accensione" : "spegnimento"} inviata.`)
            this.startCooldown(target)
            try {
                await this.$store.dispatch("bot/updateEnabled", enabled)
                this.pushLog("success", "Stato aggiornato correttamente dal server.")
            } catch (error) {
                this.cancelCooldown()
                if (error.code === 409) {
                    this.setFlash(error.message, "warning")
                    this.pushLog("warning", "Operazione già in corso: nessuna modifica applicata.")
                } else {
                    this.setFlash("Non è stato possibile aggiornare lo stato del bot.", "warning")
                    this.pushLog("error", "Toggle fallito: controlla i log del server per maggiori dettagli.")
                }
                // eslint-disable-next-line no-console
                console.error("Toggle bot failed", error)
            }
        },
        startCooldown(target) {
            this.cancelCooldown({ silent: true })
            this.cooldown.target = target
            this.cooldown.active = true
            this.cooldown.remaining = this.cooldown.duration
            this.cooldownStart = Date.now()
            this.pushLog("system", "Periodo di sicurezza di 15 secondi attivato.")
            this.cooldownInterval = setInterval(() => {
                const elapsed = Date.now() - this.cooldownStart
                const remaining = Math.max(0, this.cooldown.duration - elapsed)
                this.cooldown.remaining = remaining
                if (remaining <= 0) {
                    this.finishCooldown()
                }
            }, 100)
        },
        finishCooldown({ silent = false } = {}) {
            if (this.cooldownInterval) {
                clearInterval(this.cooldownInterval)
                this.cooldownInterval = null
            }
            this.cooldown.active = false
            this.cooldown.remaining = 0
            this.cooldown.target = null
            this.cooldownStart = null
            if (!silent) {
                this.pushLog("system", "Cooldown completato: i controlli sono di nuovo disponibili.")
            }
        },
        cancelCooldown({ silent = false } = {}) {
            if (!this.cooldown.active && !this.cooldownInterval) {
                return
            }
            this.finishCooldown({ silent })
        },
        async handleSearch(value) {
            try {
                const searchValue = value && value.trim() ? value.trim() : undefined
                await this.$store.dispatch("users/fetchUsers", {
                    page: 1,
                    search: searchValue
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
        },
        handleActionSuccess(message) {
            this.setFlash(message, "success")
            this.pushLog("success", message)
        },
        handleActionError(message) {
            this.setFlash(message, "warning")
            this.pushLog("error", message)
        },
        async handleKillRequest(payload) {
            const target = payload?.target || "bot"
            if (target === "mysql") {
                const message = "La terminazione del servizio MySQL non è disponibile dal pannello."
                this.setFlash(message, "warning")
                this.pushLog("warning", "Richiesta di terminare il servizio MySQL non supportata dal pannello.")
                return
            }
            await this.requestKillBot()
        },
        async requestKillBot() {
            if (this.botKillPending) return

            const csrfToken = this.$store.state.session.csrfToken
            if (!csrfToken) {
                this.handleActionError("Impossibile terminare il processo del bot.")
                return
            }

            this.botKillPending = true
            this.pushLog("info", "Comando 'Termina bot' richiesto.")

            try {
                await api.killBot({ csrfToken })
                this.handleActionSuccess("Il processo del bot verrà terminato a breve.")
                this.pushLog("success", "Comando 'Termina bot' inviato al server.")
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error("Failed to kill bot process", error)
                this.handleActionError("Impossibile terminare il processo del bot.")
            } finally {
                this.botKillPending = false
            }
        },
        ...mapActions("logs", { addLogEntry: "add" }),
        pushLog(level, message) {
            if (!message) return
            this.addLogEntry({ level, message })
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
