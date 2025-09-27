<template>
    <div class="card access-policy-card">
        <header class="access-policy-card__header">
            <div>
                <p class="access-policy-card__eyebrow">Bot access policy</p>
                <h3 class="access-policy-card__title">Whitelist protection</h3>
                <p class="access-policy-card__subtitle">
                    Blacklist always blocks the bot. When whitelist mode is active only whitelisted users and admins can use Chipsy.
                </p>
            </div>
            <div class="access-policy-card__toggle">
                <span class="access-policy-card__toggle-label">Enable whitelist</span>
                <button
                    type="button"
                    class="toggle-switch"
                    role="switch"
                    :aria-checked="isActive"
                    :class="{ 'toggle-switch--active': isActive }"
                    :disabled="toggleDisabled"
                    @click="handleToggle"
                >
                    <span class="toggle-switch__track">
                        <span class="toggle-switch__thumb" :class="{ 'toggle-switch__thumb--active': isActive }"></span>
                    </span>
                    <span class="toggle-switch__state" aria-hidden="true">
                        {{ isActive ? "On" : "Off" }}
                    </span>
                    <span v-if="toggleDisabled" class="toggle-switch__loader">
                        <span class="button__spinner"></span>
                    </span>
                </button>
            </div>
        </header>

        <ul class="access-policy-card__rules">
            <li>
                <strong>Always blocked:</strong> anyone on the blacklist.
            </li>
            <li>
                <strong>Always allowed:</strong> admins and whitelisted IDs.
            </li>
            <li>
                <strong>Default users:</strong> follow the current whitelist toggle.
            </li>
        </ul>

        <div class="access-policy-card__meta-row">
            <p class="access-policy-card__meta">
                <span v-if="updatedAt">Updated {{ updatedAt }}</span>
                <span v-else>Waiting for the first change</span>
            </p>
            <span class="access-policy-card__hint">
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

<style scoped>
.access-policy-card {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 22px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: var(--radius-xl);
}

.access-policy-card__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.access-policy-card__eyebrow {
    margin: 0 0 4px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78rem;
    color: #94a3b8;
}

.access-policy-card__title {
    margin: 0;
    font-size: 1.2rem;
    color: #f8fafc;
}

.access-policy-card__subtitle {
    margin: 6px 0 0;
    color: #cbd5f5;
    font-size: 0.9rem;
}

.access-policy-card__toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: var(--radius-full, 999px);
    padding: 6px 12px 6px 16px;
    background: rgba(15, 23, 42, 0.35);
    flex-shrink: 0;
}

.access-policy-card__toggle-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
}

.toggle-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: transparent;
    color: #94a3b8;
    cursor: pointer;
    padding: 0;
    position: relative;
}

.toggle-switch:disabled {
    cursor: not-allowed;
    opacity: 0.7;
}

.toggle-switch__track {
    width: 48px;
    height: 24px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.25);
    position: relative;
    transition: background var(--transition-fast);
}

.toggle-switch--active .toggle-switch__track {
    background: rgba(16, 185, 129, 0.4);
}

.toggle-switch__thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #f8fafc;
    transition: transform var(--transition-fast);
}

.toggle-switch__thumb--active {
    transform: translateX(24px);
}

.toggle-switch__state {
    font-size: 0.85rem;
    font-weight: 600;
    min-width: 24px;
    text-align: left;
}

.toggle-switch__loader {
    position: absolute;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
}

.access-policy-card__rules {
    margin: 0;
    padding-left: 18px;
    color: #cbd5f5;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.access-policy-card__rules li strong {
    color: #f8fafc;
}

.access-policy-card__meta-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
}

.access-policy-card__meta {
    font-size: 0.85rem;
    color: #94a3b8;
    margin: 0;
}

.access-policy-card__hint {
    font-size: 0.85rem;
    color: rgba(248, 250, 252, 0.8);
}

.access-policy-card__actions {
    display: none;
}
</style>
