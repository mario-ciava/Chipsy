<template>
    <div class="logs-view">
        <header class="logs-view__header">
            <div>
                <h1 class="logs-view__title">Console log</h1>
                <p class="logs-view__subtitle">
                    Monitor the events captured by the control panel and the bot's admin actions.
                </p>
            </div>
        </header>
        <section class="logs-view__content">
            <LogConsole
                :logs="generalLogs"
                title="Activity log"
                subtitle="Panel events, bot status, admin actions, and system notices."
            />
            <LogConsole
                :logs="commandLogs"
                title="Command log"
                subtitle="Records every command executed through the terminal. Enable recording to populate this feed."
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
        this.addLogEntry({ level: "system", message: "Console log opened." })

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
                ? "Command recording enabled."
                : "Command recording disabled."
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
