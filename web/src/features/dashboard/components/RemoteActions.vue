<template>
    <div class="chip-card space-y-6">
        <div class="chip-card__header">
            <div>
                <h3 class="chip-card__title">Quick actions</h3>
                <p class="chip-card__subtitle">
                    Modular shell waiting for whatever remote commands we wire up next.
                </p>
            </div>
        </div>
        <div class="space-y-4">
            <ul class="divide-y divide-white/5">
                <li v-for="action in actions" :key="action.id" class="flex flex-wrap items-center justify-between gap-4 py-4">
                    <div class="min-w-[200px] flex-1">
                        <h4 class="text-base font-semibold text-white">
                            {{ action.label }}
                        </h4>
                        <p class="mt-1 text-sm text-slate-300">{{ action.description }}</p>
                    </div>
                    <button
                        v-if="action.type === 'command'"
                        class="chip-btn"
                        :class="action.dangerous ? 'chip-btn-danger' : 'chip-btn-secondary'"
                        :disabled="loading"
                        @click="handleAction(action)"
                    >
                        <span v-if="loading" class="chip-spinner"></span>
                        <span v-else>Execute</span>
                    </button>
                    <button v-else class="chip-btn chip-btn-ghost" disabled>
                        {{ action.pendingLabel || "Coming soon" }}
                    </button>
                </li>
            </ul>
            <p v-if="!actions.length" class="chip-empty">
                No remote actions configured yet. Ship them server-side before expecting magic here.
            </p>
        </div>

        <transition name="fade">
            <div v-if="showConfirm" class="chip-modal-overlay" @click.self="cancelConfirm">
                <div class="chip-modal space-y-4">
                    <div>
                        <h3 class="text-xl font-semibold text-white">{{ confirmTitle }}</h3>
                        <p class="mt-2 text-sm text-slate-300">{{ confirmMessage }}</p>
                    </div>
                    <div class="flex justify-end gap-3">
                        <button class="chip-btn chip-btn-ghost" @click="cancelConfirm">
                            Cancel
                        </button>
                        <button class="chip-btn chip-btn-danger" @click="proceedConfirm">
                            {{ confirmStep === 1 ? "Continue" : "Confirm" }}
                        </button>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
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
        formatActionLabel(action) {
            if (!action) return "unknown command"
            const label = action.label || action.id || "command"
            const identifier = action.id && action.id !== label ? ` [${action.id}]` : ""
            return `'${label}'${identifier}`
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
                const descriptor = this.formatActionLabel(action)
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication token")
                }

                const response = await api.runAdminAction({ csrfToken, actionId: action.id })
                const message = response?.message || `Action ${descriptor} completed successfully.`
                this.$emit("action-success", message)
            } catch (error) {
                const descriptor = this.formatActionLabel(action)
                const message =
                    error?.response?.data?.message ||
                    error?.message ||
                    `Action ${descriptor} failed.`
                this.$emit("action-error", message)
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
