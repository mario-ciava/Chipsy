<template>
    <div class="chip-card chip-stack">
        <header class="chip-card__header items-start">
            <div class="chip-stack">
                <div class="flex items-center gap-2">
                    <span class="chip-eyebrow">Access policy</span>
                    <span
                        class="chip-info-dot"
                        role="img"
                        tabindex="0"
                        aria-label="Whitelist rules"
                        :data-tooltip="policyInfo"
                    ></span>
                </div>
                <h3 class="chip-card__title">Whitelist protection</h3>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Keep Discord commands scoped to trusted IDs and admins whenever you need to lock things down.
                </p>
            </div>
        </header>

        <div class="chip-divider chip-divider--strong my-1.5"></div>
        <div class="flex flex-col gap-4">
            <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col">
                    <span class="chip-status__label">Whitelist state</span>
                    <span class="chip-field-hint">
                        Enforce access to trusted IDs only.
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <ChipToggle
                        class="w-40"
                        :label="primaryToggleLabel"
                        :checked="displayWhitelistState"
                        :busy="loading"
                        :disabled="toggleDisabled"
                        :tone="primaryToggleTone"
                        aria-label="Whitelist state toggle"
                        @toggle="handleToggle"
                    />
                    <button
                        class="chip-icon-btn"
                        type="button"
                        aria-label="View whitelist entries"
                        title="View whitelist entries"
                        @click="$emit('view-whitelist')"
                    >
                        <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path d="M5 12h14" stroke-linecap="round" />
                            <path d="M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </button>
                </div>
            </div>
            <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col">
                    <span class="chip-status__label">Blacklist state</span>
                    <span class="chip-field-hint">
                        Block listed IDs from interacting with Chipsy.
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <ChipToggle
                        class="w-40"
                        :label="blacklistToggleLabel"
                        :checked="displayBlacklistState"
                        :busy="loading"
                        :disabled="toggleDisabled"
                        :tone="blacklistToggleTone"
                        aria-label="Blacklist state toggle"
                        @toggle="handleBlacklistToggle"
                    />
                    <button
                        class="chip-icon-btn"
                        type="button"
                        aria-label="View blacklist entries"
                        title="View blacklist entries"
                        @click="$emit('view-blacklist')"
                    >
                        <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path d="M5 12h14" stroke-linecap="round" />
                            <path d="M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </button>
                </div>
            </div>
            <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col">
                    <span class="chip-status__label">Invite quarantine</span>
                    <span class="chip-field-hint">
                        Auto-block unverified server invites.
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <ChipToggle
                        class="w-40"
                        :label="quarantineToggleLabel"
                        :checked="displayQuarantineState"
                        :busy="loading"
                        :disabled="toggleDisabled"
                        :tone="quarantineToggleTone"
                        aria-label="Invite quarantine toggle"
                        @toggle="handleQuarantineToggle"
                    />
                    <button
                        class="chip-icon-btn"
                        type="button"
                        aria-label="View quarantine entries"
                        title="View quarantine entries"
                        @click="$emit('view-quarantine')"
                    >
                        <svg
                            class="h-4 w-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            aria-hidden="true"
                        >
                            <path d="M5 12h14" stroke-linecap="round" />
                            <path d="M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import ChipToggle from "./ChipToggle.vue"

export default {
    name: "AccessPolicyCard",
    components: {
        ChipToggle
    },
    data() {
        return {
            optimisticState: null,
            optimisticBlacklist: null,
            optimisticQuarantine: null
        }
    },
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
    watch: {
        policy: {
            deep: true,
            handler(newPolicy) {
                if (this.optimisticState !== null) {
                    const enforced = typeof newPolicy?.enforceWhitelist === "boolean"
                        ? newPolicy.enforceWhitelist
                        : null
                    if (enforced !== null && enforced === this.optimisticState) {
                        this.optimisticState = null
                    }
                }
                if (this.optimisticBlacklist !== null) {
                    const blacklistState = typeof newPolicy?.enforceBlacklist === "boolean"
                        ? newPolicy.enforceBlacklist
                        : null
                    if (blacklistState !== null && blacklistState === this.optimisticBlacklist) {
                        this.optimisticBlacklist = null
                    }
                }
                if (this.optimisticQuarantine !== null) {
                    const quarantineState = typeof newPolicy?.enforceQuarantine === "boolean"
                        ? newPolicy.enforceQuarantine
                        : null
                    if (quarantineState !== null && quarantineState === this.optimisticQuarantine) {
                        this.optimisticQuarantine = null
                    }
                }
            }
        },
        saving(newVal, oldVal) {
            if (!newVal && oldVal && this.optimisticState !== null) {
                const enforced = typeof this.policy?.enforceWhitelist === "boolean"
                    ? this.policy.enforceWhitelist
                    : null
                if (enforced !== this.optimisticState) {
                    this.optimisticState = null
                }
            }
            if (!newVal && oldVal && this.optimisticBlacklist !== null) {
                const blacklistState = typeof this.policy?.enforceBlacklist === "boolean"
                    ? this.policy.enforceBlacklist
                    : null
                if (blacklistState !== this.optimisticBlacklist) {
                    this.optimisticBlacklist = null
                }
            }
            if (!newVal && oldVal && this.optimisticQuarantine !== null) {
                const quarantineState = typeof this.policy?.enforceQuarantine === "boolean"
                    ? this.policy.enforceQuarantine
                    : null
                if (quarantineState !== this.optimisticQuarantine) {
                    this.optimisticQuarantine = null
                }
            }
        }
    },
    computed: {
        isActive() {
            return Boolean(this.policy?.enforceWhitelist)
        },
        isBlacklistActive() {
            if (typeof this.policy?.enforceBlacklist === "boolean") {
                return this.policy.enforceBlacklist
            }
            return true
        },
        displayWhitelistState() {
            if (this.optimisticState !== null) return this.optimisticState
            return this.isActive
        },
        displayBlacklistState() {
            if (this.optimisticBlacklist !== null) return this.optimisticBlacklist
            return this.isBlacklistActive
        },
        isQuarantineActive() {
            if (typeof this.policy?.enforceQuarantine === "boolean") {
                return this.policy.enforceQuarantine
            }
            return false
        },
        displayQuarantineState() {
            if (this.optimisticQuarantine !== null) return this.optimisticQuarantine
            return this.isQuarantineActive
        },
        policyInfo() {
            return "Whitelist restricts usage to curated IDs, blacklist blocks offenders and invite quarantine mutes new servers until approved."
        },
        toggleDisabled() {
            return this.loading || this.saving
        },
        primaryToggleLabel() {
            return this.displayWhitelistState ? "Enabled" : "Disabled"
        },
        primaryToggleTone() {
            if (this.loading) return "warn"
            return this.displayWhitelistState ? "ok" : "danger"
        },
        blacklistToggleLabel() {
            return this.displayBlacklistState ? "Enabled" : "Disabled"
        },
        blacklistToggleTone() {
            if (this.loading) return "warn"
            return this.displayBlacklistState ? "danger" : "ok"
        },
        quarantineToggleLabel() {
            return this.displayQuarantineState ? "Enabled" : "Disabled"
        },
        quarantineToggleTone() {
            if (this.loading) return "warn"
            return this.displayQuarantineState ? "warn" : ""
        }
    },
    methods: {
        handleToggle(nextState) {
            if (this.toggleDisabled) return
            const targetState = typeof nextState === "boolean" ? nextState : !this.isActive
            this.optimisticState = targetState
            this.$emit("toggle", targetState)
        },
        handleBlacklistToggle(nextState) {
            if (this.toggleDisabled) return
            const targetState = typeof nextState === "boolean" ? nextState : !this.isBlacklistActive
            this.optimisticBlacklist = targetState
            this.$emit("toggle-blacklist", targetState)
        },
        handleQuarantineToggle(nextState) {
            if (this.toggleDisabled) return
            const targetState = typeof nextState === "boolean" ? nextState : !this.isQuarantineActive
            this.optimisticQuarantine = targetState
            this.$emit("toggle-quarantine", targetState)
        }
    }
}
</script>
