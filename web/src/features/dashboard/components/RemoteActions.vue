<template>
    <div class="card">
        <div class="card__header">
            <div>
                <h3 class="card__title">Quick actions</h3>
                <p class="card__subtitle">
                    Modular shell waiting for whatever remote commands we wire up next.
                </p>
            </div>
        </div>
        <div class="card__body">
            <ul class="actions">
                <li v-for="action in actions" :key="action.id" class="actions__item">
                    <div>
                        <h4 class="actions__title">
                            {{ action.label }}
                            <span v-if="action.badge" class="actions__badge">{{ action.badge }}</span>
                        </h4>
                        <p class="actions__description">{{ action.description }}</p>
                    </div>
                    <button
                        v-if="action.type === 'command'"
                        class="button button--secondary"
                        :class="{ 'button--danger': action.dangerous }"
                        :disabled="loading"
                        @click="handleAction(action)"
                    >
                        <span v-if="loading" class="button__spinner"></span>
                        <span v-else>Execute</span>
                    </button>
                    <button v-else class="button button--ghost" disabled>
                        {{ action.pendingLabel || 'Coming soon' }}
                    </button>
                </li>
            </ul>
            <p v-if="!actions.length" class="actions__empty">
                No remote actions configured yet. Ship them server-side before expecting magic here.
            </p>
        </div>

        <transition name="fade">
            <div v-if="showConfirm" class="modal-overlay" @click.self="cancelConfirm">
                <div class="modal-dialog">
                    <div class="modal-header">
                        <h3 class="modal-title">{{ confirmTitle }}</h3>
                    </div>
                    <div class="modal-body">
                        <p>{{ confirmMessage }}</p>
                    </div>
                    <div class="modal-footer">
                        <button class="button button--ghost" @click="cancelConfirm">
                            Cancel
                        </button>
                        <button class="button button--danger" @click="proceedConfirm">
                            {{ confirmStep === 1 ? 'Continue' : 'Confirm' }}
                        </button>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import { mapActions } from "vuex"
import api from "../../../services/api"

export default {
    name: "RemoteActions",
    props: {
        actions: {
            type: Array,
            default: () => []
        }
    },
    data() {
        return {
            loading: false,
            showConfirm: false,
            confirmStep: 0,
            pendingAction: null
        }
    },
    computed: {
        confirmTitle() {
            if (this.pendingAction?.confirmation?.title) {
                return this.pendingAction.confirmation.title
            }
            return this.confirmStep === 1 ? "Confirm action" : "Final confirmation"
        },
        confirmMessage() {
            const confirmation = this.pendingAction?.confirmation || {}
            if (this.confirmStep === 1 && confirmation.stepOne) {
                return confirmation.stepOne
            }
            if (this.confirmStep === 2 && confirmation.stepTwo) {
                return confirmation.stepTwo
            }
            if (this.confirmStep === 1) {
                return "Do you actually want to run this?"
            }
            return "This action is irreversible. Still sure?"
        }
    },
    methods: {
        ...mapActions("logs", { addLogEntry: "add" }),
        formatCommandLabel(action) {
            if (!action) return "unknown command"
            const label = action.label || action.id || "command"
            const identifier = action.id && action.id !== label ? ` [${action.id}]` : ""
            return `'${label}'${identifier}`
        },
        logCommandEvent(level, action, message) {
            if (!action || action.type !== "command") return
            const descriptor = this.formatCommandLabel(action)
            const finalMessage = message || `Command ${descriptor}.`
            const userId = this.$store.state.session.user?.id || null
            this.addLogEntry({
                level,
                message: finalMessage,
                logType: "command",
                userId
            })
        },
        handleAction(action) {
            if (action.dangerous || action.confirmation) {
                this.pendingAction = action
                this.confirmStep = 1
                this.showConfirm = true
            } else {
                this.executeAction(action)
            }
        },
        proceedConfirm() {
            if (this.confirmStep === 1) {
                this.confirmStep = 2
            } else {
                this.showConfirm = false
                if (this.pendingAction) {
                    this.executeAction(this.pendingAction)
                }
            }
        },
        cancelConfirm() {
            this.showConfirm = false
            this.confirmStep = 0
            this.pendingAction = null
        },
        async executeAction(action) {
            if (action.type !== "command") {
                return
            }

            this.loading = true
            try {
                const descriptor = this.formatCommandLabel(action)
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication token")
                }

                this.logCommandEvent("info", action, `Command ${descriptor} requested.`)
                const response = await api.runAdminAction({ csrfToken, actionId: action.id })
                const message = response?.message || `Action ${descriptor} completed successfully.`
                this.$emit("action-success", message)
                this.logCommandEvent("success", action, `Command ${descriptor} completed.`)
            } catch (error) {
                const descriptor = this.formatCommandLabel(action)
                const message =
                    error?.response?.data?.message ||
                    error?.message ||
                    `Action ${descriptor} failed.`
                this.$emit("action-error", message)
                this.logCommandEvent("error", action, `Command ${descriptor} failed: ${message}`)
            } finally {
                if (action === this.pendingAction) {
                    this.pendingAction = null
                }
                this.confirmStep = 0
                this.loading = false
                this.showConfirm = false
            }
        }
    }
}
</script>

<style scoped>
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.modal-dialog {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-xl);
    padding: 28px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 40px 80px -24px rgba(15, 23, 42, 0.85);
}

.modal-header {
    margin-bottom: 16px;
}

.modal-title {
    margin: 0;
    font-size: 1.4rem;
    color: var(--fg-primary);
}

.modal-body {
    margin-bottom: 24px;
    color: var(--fg-muted);
}

.modal-body p {
    margin: 0;
}

.modal-footer {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
