<template>
    <div class="card access-policy-card">
        <header class="access-policy-card__header">
            <div>
                <h3 class="access-policy-card__title">Access policy</h3>
                <p class="access-policy-card__subtitle">
                    Blacklist always blocks the bot. When whitelist mode is active only whitelisted users and admins can use Chipsy.
                </p>
            </div>
            <span
                class="access-policy-card__badge"
                :class="isActive ? 'access-policy-card__badge--active' : 'access-policy-card__badge--idle'"
            >
                {{ isActive ? "Whitelist active" : "Whitelist disabled" }}
            </span>
        </header>

        <p class="access-policy-card__meta" v-if="updatedAt">
            Updated {{ updatedAt }}
        </p>

        <button
            type="button"
            class="button button--secondary access-policy-card__button"
            :disabled="loading || saving"
            @click="$emit('toggle', !isActive)"
        >
            <span v-if="loading || saving" class="button__spinner"></span>
            <span v-else>{{ isActive ? "Disable whitelist" : "Enable whitelist" }}</span>
        </button>
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
        }
    }
}
</script>

<style scoped>
.access-policy-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px;
    background: rgba(15, 23, 42, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.15);
}

.access-policy-card__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
}

.access-policy-card__title {
    margin: 0;
    font-size: 1.1rem;
    color: #f8fafc;
}

.access-policy-card__subtitle {
    margin: 4px 0 0;
    color: #cbd5f5;
    font-size: 0.9rem;
}

.access-policy-card__badge {
    align-self: flex-start;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
}

.access-policy-card__badge--active {
    background: rgba(34, 197, 94, 0.15);
    color: #bbf7d0;
}

.access-policy-card__badge--idle {
    background: rgba(148, 163, 184, 0.1);
    color: #cbd5f5;
}

.access-policy-card__meta {
    font-size: 0.85rem;
    color: #94a3b8;
}

.access-policy-card__button {
    align-self: flex-start;
}
</style>
