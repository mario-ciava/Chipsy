<template>
    <div :class="containerClasses" :style="panelStyle">
        <div v-if="showHeader" :class="headerClasses">
            <div>
                <h3 :class="titleClasses">{{ title }}</h3>
                <p :class="subtitleClasses">
                    {{ subtitle }}
                </p>
            </div>
        </div>
        <div v-if="showHeader && !isEmbedded" class="chip-divider chip-divider--strong my-1"></div>
        <div :class="scrollClasses" :style="consoleStyle" ref="scrollContainer">
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
        },
        variant: {
            type: String,
            default: "card",
            validator: (value) => ["card", "embedded"].includes(value)
        },
        showHeader: {
            type: Boolean,
            default: true
        },
        panelHeight: {
            type: [String, Number],
            default: null
        }
    },
    computed: {
        isEmbedded() {
            return this.variant === "embedded"
        },
        titleClasses() {
            return this.isEmbedded ? "text-2xl font-semibold text-white" : "chip-card__title"
        },
        subtitleClasses() {
            return this.isEmbedded
                ? "chip-card__subtitle chip-card__subtitle--tight text-sm text-slate-400"
                : "chip-card__subtitle chip-card__subtitle--tight"
        },
        panelStyle() {
            if (!this.panelHeight) return null
            const value = typeof this.panelHeight === "number" ? `${this.panelHeight}px` : String(this.panelHeight)
            return {
                minHeight: value,
                maxHeight: value
            }
        },
        containerClasses() {
            if (this.isEmbedded) {
                const classes = ["chip-stack", "gap-3"]
                if (this.panelHeight) {
                    classes.push("flex", "flex-col", "h-full")
                }
                return classes.join(" ")
            }
            const classes = ["chip-card", "flex", "flex-col", "gap-4"]
            if (this.panelHeight) {
                classes.push("h-full")
            }
            return classes.join(" ")
        },
        headerClasses() {
            const classes = this.isEmbedded ? ["chip-stack", "gap-1"] : ["chip-card__header"]
            if (this.panelHeight) {
                classes.push("shrink-0")
            }
            return classes.join(" ")
        },
        scrollClasses() {
            const classes = ["chip-scroll"]
            if (this.panelHeight) {
                classes.push("flex-1", "min-h-0")
            }
            return classes.join(" ")
        },
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
                maxHeight: value
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
