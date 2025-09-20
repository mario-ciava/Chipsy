<template>
    <div class="card log-console">
        <div class="card__header log-console__header">
            <div>
                <h3 class="card__title">{{ title }}</h3>
                <p class="card__subtitle">
                    {{ subtitle }}
                </p>
            </div>
            <div v-if="showToggle" class="log-console__toggle">
                <label class="toggle-switch">
                    <input
                        type="checkbox"
                        :checked="recordingEnabled"
                        @change="$emit('toggle-recording', $event.target.checked)"
                    />
                    <span class="toggle-switch__slider"></span>
                </label>
                <span class="log-console__toggle-label">Record commands</span>
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
        <div class="log-console__footer">
            <div class="log-console__hint">
                <strong>Remote shell</strong>
                <span>Remote command submission stays disabled here for everyone's sanity.</span>
            </div>
            <div class="log-console__input">
                <input type="text" placeholder="Remote commands disabled" disabled />
                <button class="button button--secondary" disabled>Send</button>
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
        showToggle: {
            type: Boolean,
            default: false
        },
        recordingEnabled: {
            type: Boolean,
            default: false
        }
    },
    computed: {
        formattedLogs() {
            return this.logs.map((entry) => ({
                ...entry,
                level: entry.level || "info",
                levelLabel: LEVEL_LABELS[entry.level] || (entry.level || "INFO").toUpperCase(),
                time: formatter.format(entry.timestamp || Date.now())
            }))
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
    min-height: 100%;
    height: 100%;
}


.log-console__header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    flex-wrap: wrap;
}

.log-console__header > div:first-child {
    flex: 1 1 auto;
}

.log-console__toggle {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.28);
    background: rgba(15, 23, 42, 0.38);
    box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.12);
    margin-left: auto;
    align-self: flex-start;
}

.log-console__toggle-label {
    color: var(--fg-secondary);
    font-size: 0.9rem;
    font-weight: 500;
}

.toggle-switch {
    position: relative;
    display: inline-block;
    width: 56px;
    height: 30px;
}

.toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
}

.toggle-switch__slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgba(148, 163, 184, 0.25);
    border: 1px solid rgba(148, 163, 184, 0.3);
    transition: 0.3s;
    border-radius: 26px;
}

.toggle-switch__slider:before {
    position: absolute;
    content: "";
    height: 20px;
    width: 20px;
    left: 4px;
    bottom: 4px;
    background: white;
    transition: 0.3s;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.toggle-switch input:checked + .toggle-switch__slider {
    background: linear-gradient(135deg, #7c3aed, #a855f7);
    border-color: #7c3aed;
}

.toggle-switch input:checked + .toggle-switch__slider:before {
    transform: translateX(24px);
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
    padding: 16px 12px;
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

.log-console__footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 4px;
    margin-top: auto;
}

.log-console__hint {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: rgba(148, 163, 184, 0.9);
    font-size: 0.85rem;
}

.log-console__hint strong {
    color: rgba(226, 232, 240, 0.95);
}

.log-console__input {
    display: flex;
    gap: 12px;
}

.log-console__input input {
    flex: 1;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 10px 12px;
    color: rgba(148, 163, 184, 0.7);
}

.log-console__input input::placeholder {
    color: rgba(148, 163, 184, 0.45);
}

.log-console__input button {
    opacity: 0.45;
    cursor: not-allowed;
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
    .log-console__body {
        max-height: 200px;
    }

    .log-console__line {
        grid-template-columns: 60px 48px 1fr;
        font-size: 0.82rem;
    }
}
</style>
