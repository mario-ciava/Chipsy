<template>
    <transition name="fade">
        <div v-if="visible" class="chip-modal-overlay z-50" @click.self="$emit('close')">
            <div class="chip-modal chip-stack max-w-2xl w-full">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">Access lists</span>
                        <h3 class="text-2xl font-semibold text-white">{{ title }}</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            {{ description }}
                        </p>
                    </div>
                    <button type="button" class="chip-btn chip-btn-ghost chip-btn-fixed" @click="$emit('close')">
                        Close
                    </button>
                </header>
                <div class="chip-divider chip-divider--strong"></div>
                <div v-if="loading" class="chip-empty">Loading the latest entries…</div>
                <div v-else-if="error" class="chip-notice chip-notice-warning">
                    {{ error }}
                </div>
                <div v-else class="chip-stack max-h-[60vh] overflow-y-auto">
                    <p v-if="!entries.length" class="chip-empty text-sm text-slate-400">
                        {{ emptyLabel }}
                    </p>
                    <ul v-else class="chip-stack divide-y divide-white/5">
                        <li
                            v-for="entry in entries"
                            :key="entry.userId"
                            class="flex flex-col gap-2 py-2 text-sm text-slate-200"
                        >
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div class="flex flex-col">
                                    <span class="text-base font-semibold text-white">
                                        {{ entry.username || "Unknown user" }}
                                    </span>
                                    <span class="chip-field-hint text-slate-400">
                                        {{ entry.userId }}
                                    </span>
                                </div>
                                <span class="chip-pill chip-pill-info text-xs uppercase tracking-[0.3em]">
                                    {{ entry.role }}
                                </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                                    @click="copyId(entry.userId)"
                                >
                                    Copy ID
                                </button>
                                <span class="chip-field-hint text-slate-500">
                                    Updated {{ formatTimestamp(entry.updatedAt) }}
                                </span>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </transition>
</template>

<script>
import { formatFriendlyDateTime } from "../../../utils/formatters"
import { copyToClipboard } from "../../../utils/clipboard"
import { showToast } from "../../../utils/toast"

export default {
    name: "AccessListModal",
    props: {
        visible: {
            type: Boolean,
            default: false
        },
        type: {
            type: String,
            default: "whitelist"
        },
        entries: {
            type: Array,
            default: () => []
        },
        loading: {
            type: Boolean,
            default: false
        },
        error: {
            type: String,
            default: null
        }
    },
    computed: {
        title() {
            return this.type === "blacklist" ? "Blacklist entries" : "Whitelist entries"
        },
        description() {
            if (this.type === "blacklist") {
                return "Users listed here will be ignored whenever blacklist enforcement is active."
            }
            return "Only these IDs (plus admins) can use Chipsy while whitelist enforcement is active."
        },
        emptyLabel() {
            return this.type === "blacklist"
                ? "No users are currently blacklisted."
                : "No users are currently whitelisted."
        }
    },
    methods: {
        formatTimestamp(value) {
            if (!value) return "recently"
            return formatFriendlyDateTime(value)
        },
        async copyId(id) {
            try {
                await copyToClipboard(id)
                showToast("Copied ID to clipboard.")
            } catch (error) {
                showToast("Unable to copy the ID.")
            }
        }
    }
}
</script>
