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
            </div>
            <div class="flex items-center justify-between gap-4">
                <div class="flex flex-col">
                    <span class="chip-status__label">Invite quarantine</span>
                    <span class="chip-field-hint">
                        Auto-block unverified server invites.
                    </span>
                </div>
                <ChipToggle
                    class="w-40"
                    :label="secondaryToggleLabel"
                    :checked="false"
                    :disabled="true"
                    tone="warn"
                    aria-label="Invite quarantine toggle"
                />
            </div>
            <div class="h-px w-full bg-white/10"></div>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p class="chip-status__label">Lists</p>
                    <p class="chip-field-hint">Inspect the IDs enforced by the policy.</p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button class="chip-btn chip-btn-secondary opacity-60" type="button" disabled>
                        Show whitelist
                    </button>
                    <button class="chip-btn chip-btn-secondary opacity-60" type="button" disabled>
                        Show blacklist
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
            optimisticState: null
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
                if (this.optimisticState === null) return
                const enforced = typeof newPolicy?.enforceWhitelist === "boolean"
                    ? newPolicy.enforceWhitelist
                    : null
                if (enforced !== null && enforced === this.optimisticState) {
                    this.optimisticState = null
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
        }
    },
    computed: {
        isActive() {
            return Boolean(this.policy?.enforceWhitelist)
        },
        displayWhitelistState() {
            if (this.optimisticState !== null) return this.optimisticState
            return this.isActive
        },
        policyInfo() {
            return "Blacklist always blocks Chipsy. When whitelist is enforced, only admins and curated IDs get responses."
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
        secondaryToggleLabel() {
            return "Coming soon"
        }
    },
    methods: {
        handleToggle(nextState) {
            if (this.toggleDisabled) return
            const targetState = typeof nextState === "boolean" ? nextState : !this.isActive
            this.optimisticState = targetState
            this.$emit("toggle", targetState)
        }
    }
}
</script>
