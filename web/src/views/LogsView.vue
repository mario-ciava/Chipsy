<template>
    <div class="logs-view">
        <header class="logs-view__header">
            <div>
                <h1 class="logs-view__title">Console log</h1>
                <p class="logs-view__subtitle">
                    Monitora gli eventi registrati dal pannello di controllo e dalle azioni amministrative del bot.
                </p>
            </div>
        </header>
        <section class="logs-view__content">
            <LogConsole
                :logs="generalLogs"
                title="Log attività"
                subtitle="Eventi del pannello, stato bot, azioni amministrative e notifiche di sistema."
            />
            <LogConsole
                :logs="commandLogs"
                title="Log comandi"
                subtitle="Registro dei comandi eseguiti tramite il terminale. Attiva la registrazione per popolare questo log."
                :show-toggle="true"
                :recording-enabled="commandRecordingEnabled"
                @toggle-recording="toggleCommandRecording"
            />
        </section>
    </div>
</template>

<script>
import { mapActions, mapGetters, mapState } from "vuex"
import LogConsole from "../components/dashboard/LogConsole.vue"

export default {
    name: "LogsView",
    components: {
        LogConsole
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated"]),
        ...mapGetters("logs", {
            commandRecordingEnabled: "isCommandRecordingEnabled"
        }),
        ...mapState("logs", {
            generalLogs: (state) => state.entries,
            commandLogs: (state) => state.commandEntries
        })
    },
    async created() {
        if (!this.isAuthenticated) {
            this.$router.replace({ name: "Login" })
            return
        }
        this.addLogEntry({ level: "system", message: "Console log aperta." })

        await Promise.all([
            this.loadLogs("general"),
            this.loadLogs("command")
        ])
    },
    methods: {
        ...mapActions("logs", {
            addLogEntry: "add",
            loadLogs: "loadLogs",
            setCommandRecording: "setCommandRecording"
        }),
        toggleCommandRecording(enabled) {
            this.setCommandRecording(enabled)
            const message = enabled
                ? "Registrazione comandi attivata."
                : "Registrazione comandi disattivata."
            this.addLogEntry({
                level: "system",
                message
            })
        }
    }
}
</script>

<style scoped>
.logs-view {
    display: flex;
    flex-direction: column;
    gap: 28px;
}

.logs-view__header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
}

.logs-view__title {
    margin: 0;
    font-size: clamp(2rem, 3.2vw, 2.8rem);
    letter-spacing: -0.02em;
}

.logs-view__subtitle {
    margin: 8px 0 0;
    max-width: 720px;
    color: rgba(226, 232, 240, 0.76);
}

.logs-view__content {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 28px;
}

@media (max-width: 1200px) {
    .logs-view__content {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
