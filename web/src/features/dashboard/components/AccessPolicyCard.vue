<template>
    <div class="chip-card space-y-6">
        <header class="chip-card__header">
            <div>
                <p class="chip-label">Bot access policy</p>
                <h3 class="chip-card__title">Whitelist protection</h3>
                <p class="chip-card__subtitle">
                    Blacklist always blocks the bot. When whitelist mode is active only whitelisted users and admins can use Chipsy.
                </p>
            </div>
            <div class="flex flex-col items-end gap-2 text-right">
                <span class="text-xs font-semibold uppercase tracking-wide text-slate-400">Enable whitelist</span>
                <button
                    type="button"
                    role="switch"
                    :aria-checked="isActive"
                    class="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 transition hover:border-violet-400/40"
                    :class="{ 'cursor-not-allowed opacity-60': toggleDisabled }"
                    :disabled="toggleDisabled"
                    @click="handleToggle"
                >
                    <span class="relative inline-flex h-6 w-12 items-center rounded-full bg-slate-800/80 transition" :class="isActive ? 'bg-emerald-500/40' : ''">
                        <span
                            class="absolute left-1 h-4 w-4 rounded-full bg-white transition"
                            :class="isActive ? 'translate-x-5 bg-emerald-100' : ''"
                        ></span>
                    </span>
                    <span class="text-sm font-semibold" :class="isActive ? 'text-emerald-200' : 'text-slate-400'">
                        {{ isActive ? "On" : "Off" }}
                    </span>
                    <span v-if="toggleDisabled" class="chip-spinner"></span>
                </button>
            </div>
        </header>

        <ul class="space-y-2 text-sm text-slate-300">
            <li>
                <strong class="text-white">Always blocked:</strong> anyone on the blacklist.
            </li>
            <li>
                <strong class="text-white">Always allowed:</strong> admins and whitelisted IDs.
            </li>
            <li>
                <strong class="text-white">Default users:</strong> follow the current whitelist toggle.
            </li>
        </ul>

        <div class="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <p class="m-0">
                <span v-if="updatedAt">Updated {{ updatedAt }}</span>
                <span v-else>Waiting for the first change</span>
            </p>
            <span class="text-slate-200">
                {{ policyMessage }}
            </span>
        </div>
    </div>
</template>

<script>
import { formatDetailedDateTime } from "../../../utils/formatters"

export default {
    name: "AccessPolicyCard",
    props: {
        policy: {
            type: Object,
            default: null
        },
        loading: {
            type: Boolean,
            default: false
        },
        saving: {
            type: Boolean,
            default: false
        }
    },
    computed: {
        isActive() {
            return Boolean(this.policy?.enforceWhitelist)
        },
        updatedAt() {
            if (!this.policy?.updatedAt) return null
            return formatDetailedDateTime(this.policy.updatedAt)
        },
        policyMessage() {
            if (this.isActive) {
                return "Only admins and whitelisted IDs can interact with Chipsy."
            }
            return "Whitelist disabled. Users follow default access permissions."
        },
        toggleDisabled() {
            return this.loading || this.saving
        }
    },
    methods: {
        handleToggle() {
            if (this.toggleDisabled) return
            this.$emit("toggle", !this.isActive)
        }
    }
}
</script>
