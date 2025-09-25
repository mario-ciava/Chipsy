<template>
    <div class="card log-console" :style="consoleStyle">
        <div class="card__header log-console__header">
            <div class="log-console__titles">
                <h3 class="card__title">{{ title }}</h3>
                <p class="card__subtitle">
                    {{ subtitle }}
                </p>
            </div>
        </div>
        <div class="log-console__body">
            <div class="log-console__scroll" ref="scrollContainer">
                <transition-group name="log-entry" tag="ul" class="log-console__lines">
                    <li
                        v-for="entry in formattedLogs"
                        :key="entry.id"
                        :class="['log-console__line', `log-console__line--${entry.level}`]"
                    >
                        <span class="log-console__time">{{ entry.time }}</span>
                        <span class="log-console__level">{{ entry.levelLabel }}</span>
                        <span class="log-console__message">{{ entry.message }}</span>
                    </li>
                </transition-group>
                <p v-if="!logs.length" class="log-console__empty">No events logged right now.</p>
            </div>
        </div>
    </div>
</template>

<script>
const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
})

const LEVEL_LABELS = {
    info: "INFO",
    success: "OK",
    warning: "WARN",
    error: "ERR",
    debug: "DBG",
    system: "SYS"
}

const resolveTimestamp = (value) => {
    if (value instanceof Date) {
        return value
    }
    if (!value) {
        return new Date()
    }
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

const timestampValue = (entry) => {
    if (!entry) return 0
    return resolveTimestamp(entry.timestamp).getTime()
}

export default {
    name: "LogConsole",
    props: {
        logs: {
            type: Array,
            default: () => []
        },
        title: {
            type: String,
            default: "Activity log"
        },
        subtitle: {
            type: String,
            default: "Track key panel events and bot status updates."
        },
        fixedHeight: {
            type: [String, Number],
            default: null
        }
    },
    computed: {
        formattedLogs() {
            const sorted = [...this.logs].sort((a, b) => timestampValue(a) - timestampValue(b))
            return sorted.map((entry) => {
                const timestamp = resolveTimestamp(entry?.timestamp)
                const level = entry?.level || "info"
                return {
                    ...entry,
                    level,
                    levelLabel: LEVEL_LABELS[level] || level.toUpperCase(),
                    time: formatter.format(timestamp)
                }
            })
        },
        consoleStyle() {
            if (!this.fixedHeight) return null
            const value = typeof this.fixedHeight === "number" ? `${this.fixedHeight}px` : String(this.fixedHeight)
            return {
                height: value,
                maxHeight: value,
                overflow: "hidden"
            }
        }
    },
    watch: {
        logs() {
            this.$nextTick(() => {
                const el = this.$refs.scrollContainer
                if (!el) return
                el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
            })
        }
    }
}
</script>

<style scoped>
.log-console {
    display: flex;
    flex-direction: column;
    gap: 20px;
    background: radial-gradient(circle at 0% 0%, rgba(15, 118, 110, 0.08), transparent 55%),
        radial-gradient(circle at 100% 100%, rgba(37, 99, 235, 0.06), transparent 55%),
        rgba(15, 23, 42, 0.72);
    border: 1px solid rgba(148, 163, 184, 0.18);
    backdrop-filter: blur(6px);
    min-height: 420px;
    height: auto;
}

.log-console__header {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.log-console__titles {
    flex: 1 1 auto;
}

.log-console__body {
    background: rgba(2, 6, 23, 0.68);
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.85);
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    overflow: hidden;
}

.log-console__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 16px 12px 18px;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    font-size: 0.88rem;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.log-console__lines {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.log-console__line {
    display: grid;
    grid-template-columns: 68px 52px 1fr;
    gap: 12px;
    align-items: baseline;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.55);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.12);
    transition: transform 0.25s ease, box-shadow 0.25s ease;
}

.log-console__line--success {
    box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.22);
}

.log-console__line--warning {
    box-shadow: inset 0 0 0 1px rgba(250, 204, 21, 0.18);
}

.log-console__line--error {
    box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.24);
}

.log-console__line--debug {
    opacity: 0.75;
}

.log-console__time {
    color: rgba(148, 163, 184, 0.9);
}

.log-console__level {
    font-weight: 600;
    color: rgba(129, 140, 248, 0.95);
}

.log-console__line--success .log-console__level {
    color: rgba(74, 222, 128, 0.9);
}

.log-console__line--warning .log-console__level {
    color: rgba(251, 191, 36, 0.9);
}

.log-console__line--error .log-console__level {
    color: rgba(248, 113, 113, 0.95);
}

.log-console__message {
    white-space: pre-wrap;
}

.log-console__empty {
    margin: 0;
    color: rgba(148, 163, 184, 0.7);
    text-align: center;
    padding: 12px 0;
}

.log-entry-enter-active {
    transition: transform 0.25s ease, opacity 0.25s ease;
}

.log-entry-leave-active {
    transition: opacity 0.2s ease;
}

.log-entry-enter-from {
    opacity: 0;
    transform: translateY(8px);
}

.log-entry-leave-to {
    opacity: 0;
}

@media (max-width: 1024px) {
    .log-console__line {
        grid-template-columns: 60px 48px 1fr;
        font-size: 0.82rem;
    }
}

@media (max-width: 720px) {
    .log-console__titles {
        width: 100%;
    }

    .log-console__body {
        max-height: none;
    }
}
</style>
