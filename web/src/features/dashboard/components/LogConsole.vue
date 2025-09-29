<template>
    <div class="chip-card flex flex-col gap-4">
        <div class="chip-card__header">
            <div>
                <h3 class="chip-card__title">{{ title }}</h3>
                <p class="chip-card__subtitle">
                    {{ subtitle }}
                </p>
            </div>
        </div>
        <div class="chip-scroll" :style="consoleStyle" ref="scrollContainer">
            <transition-group name="log-entry" tag="ul" class="chip-log-lines">
                <li
                    v-for="entry in formattedLogs"
                    :key="entry.id"
                    :class="['chip-log-line', `chip-log-line--${entry.level}`]"
                >
                    <span class="chip-log-time">{{ entry.time }}</span>
                    <span class="chip-log-level">{{ entry.levelLabel }}</span>
                    <span class="whitespace-pre-wrap">{{ entry.message }}</span>
                </li>
            </transition-group>
            <p v-if="!logs.length" class="chip-log-empty">No events logged right now.</p>
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
