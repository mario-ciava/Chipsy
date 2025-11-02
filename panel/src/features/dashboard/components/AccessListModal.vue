<template>
    <transition name="chip-overlay">
        <div v-if="visible" class="chip-modal-overlay z-50" @click.self="$emit('close')">
            <div class="chip-modal-shell">
                <div class="chip-modal chip-stack w-full">
                    <button
                        type="button"
                        class="chip-icon-btn chip-modal__close"
                        aria-label="Close dialog"
                        title="Close"
                        @click="$emit('close')"
                    >
                        <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path d="M6 6l12 12" stroke-linecap="round" />
                            <path d="M18 6L6 18" stroke-linecap="round" />
                        </svg>
                    </button>
                    <header class="chip-card__header pr-12">
                        <div class="chip-stack">
                            <span class="chip-eyebrow">Access lists</span>
                            <h3 class="text-2xl font-semibold text-white">{{ title }}</h3>
                            <p class="chip-card__subtitle chip-card__subtitle--tight">
                                {{ description }}
                            </p>
                        </div>
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
                        <template v-else>
                        <ul
                            v-if="isQuarantineList"
                            class="chip-stack divide-y divide-white/5"
                        >
                            <li
                                v-for="entry in entries"
                                :key="entry.guildId || entry.userId"
                                class="chip-stack gap-2 py-3 text-sm text-slate-200"
                            >
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="chip-stack">
                                        <span class="text-base font-semibold text-white">
                                            {{ entry.name || "Unnamed server" }}
                                        </span>
                                        <span class="chip-field-hint text-slate-400">
                                            {{ entry.guildId }}
                                        </span>
                                    </div>
                                    <span
                                        class="chip-role-badge text-xs"
                                        :class="statusBadgeClass(entry.status)"
                                    >
                                        {{ formatStatus(entry.status) }}
                                    </span>
                                </div>
                                <div class="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                                    <span v-if="entry.ownerId">Owner: {{ entry.ownerId }}</span>
                                    <span v-if="entry.memberCount !== null && entry.memberCount !== undefined">
                                        Members: {{ entry.memberCount }}
                                    </span>
                                    <span>Updated {{ formatTimestamp(entry.updatedAt) }}</span>
                                </div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        class="chip-btn chip-btn-secondary"
                                        :disabled="actioningId === entry.guildId"
                                        @click="$emit('approve', entry)"
                                    >
                                        Approve
                                    </button>
                                    <button
                                        type="button"
                                        class="chip-btn chip-btn-ghost"
                                        :disabled="actioningId === entry.guildId"
                                        @click="$emit('discard', entry)"
                                    >
                                        Discard
                                    </button>
                                </div>
                            </li>
                        </ul>
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
                                    <span
                                        class="chip-role-badge"
                                        :class="roleBadgeClass(entry.role)"
                                    >
                                        {{ formatRole(entry.role) }}
                                    </span>
                                </div>
                                <div class="flex flex-wrap items-center justify-between gap-2">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <button
                                            type="button"
                                            class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                                            @click="copyId(entry.userId)"
                                        >
                                            Copy ID
                                        </button>
                                        <button
                                            v-if="canRemoveEntry(entry)"
                                            type="button"
                                            class="chip-btn chip-btn-danger px-3 py-1 text-xs"
                                            :disabled="actioningId === entry.userId"
                                            @click="$emit('remove-entry', entry)"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                    <span class="chip-field-hint text-slate-500">
                                        Updated {{ formatTimestamp(entry.updatedAt) }}
                                    </span>
                                </div>
                            </li>
                        </ul>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<script>
import { formatFriendlyDateTime } from "../../../utils/formatters"
import { copyToClipboard } from "../../../utils/clipboard"
import { showToast } from "../../../utils/toast"
import { getRoleLabel, getRoleBadgeClass } from "../../../constants/roles"

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
        },
        actioningId: {
            type: String,
            default: null
        },
        currentUserId: {
            type: String,
            default: null
        }
    },
    computed: {
        title() {
            if (this.isQuarantineList) {
                return "Quarantine queue"
            }
            if (this.type === "blacklist") {
                return "Blacklist entries"
            }
            return "Whitelist entries"
        },
        description() {
            if (this.isQuarantineList) {
                return "Servers listed here must be approved before Chipsy responds to commands."
            }
            if (this.type === "blacklist") {
                return "Users listed here will be ignored whenever blacklist enforcement is active."
            }
            return "Only these IDs (plus admins) can use Chipsy while whitelist enforcement is active."
        },
        emptyLabel() {
            if (this.isQuarantineList) {
                return "No servers are currently awaiting approval."
            }
            return this.type === "blacklist"
                ? "No users are currently blacklisted."
                : "No users are currently whitelisted."
        },
        isQuarantineList() {
            return this.type === "quarantine"
        },
        isWhitelistList() {
            return this.type === "whitelist"
        }
    },
    methods: {
        formatStatus(value) {
            if (!value) return "PENDING"
            return String(value).toUpperCase()
        },
        formatTimestamp(value) {
            if (!value) return "recently"
            return formatFriendlyDateTime(value)
        },
        formatRole(value) {
            return getRoleLabel(value)
        },
        roleBadgeClass(value) {
            return getRoleBadgeClass(value)
        },
        statusBadgeClass(value) {
            const normalized = (value || "").toString().toUpperCase()
            if (normalized === "APPROVED") {
                return "chip-role-badge--success"
            }
            if (normalized === "DISCARDED" || normalized === "REJECTED") {
                return "chip-role-badge--danger"
            }
            return "chip-role-badge--warning"
        },
        canRemoveEntry(entry) {
            if (this.isQuarantineList || !entry?.userId) return false
            if (this.currentUserId && entry.userId === this.currentUserId) {
                return false
            }
            if (this.isWhitelistList) {
                const roleKey = (entry.role || "").toString().toUpperCase()
                if (roleKey === "MASTER" || roleKey === "ADMIN") {
                    return false
                }
            }
            return true
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
