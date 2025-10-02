<template>
    <div class="chip-card chip-stack h-full min-h-0">
        <div class="chip-card__header">
            <div class="chip-stack">
                <div class="flex items-center gap-2">
                    <span class="chip-eyebrow">Quick actions</span>
                    <span
                        class="chip-info-dot"
                        role="img"
                        tabindex="0"
                        aria-label="Command info"
                        data-tooltip="Actions run through the admin API with CSRF protection."
                    ></span>
                </div>
                <div class="flex items-center gap-3">
                    <h3 class="chip-card__title">Remote controls</h3>
                </div>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Trigger maintenance routines or shell scripts directly from the dashboard.
                </p>
            </div>
        </div>
        <div class="chip-stack flex-1 overflow-hidden">
            <div class="chip-divider chip-divider--strong my-1"></div>
            <ul class="chip-scroll-hidden chip-stack divide-y divide-white/5 flex-1 pr-1">
                <li
                    v-for="action in actions"
                    :key="action.id"
                    class="flex flex-col gap-2 pt-3 pb-1.5 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between"
                >
                    <div class="min-w-[200px] flex-1">
                        <h4 class="text-base font-semibold text-white">
                            {{ action.label }}
                        </h4>
                        <p class="mt-0.5 text-sm text-slate-300">{{ action.description }}</p>
                    </div>
                    <div class="inline-flex w-full items-start justify-start gap-2 lg:w-auto">
                        <button
                            v-if="action.type === 'command'"
                            class="chip-btn chip-btn-fixed"
                            :class="action.dangerous ? 'chip-btn-danger' : 'chip-btn-secondary'"
                            :disabled="loading"
                            @click="handleAction(action)"
                        >
                            <span v-if="loading" class="chip-spinner"></span>
                            <span v-else>Execute</span>
                        </button>
                        <button v-else class="chip-btn chip-btn-secondary chip-btn-fixed" disabled>
                            {{ action.pendingLabel || "Soon" }}
                        </button>
                    </div>
                </li>
                <li class="flex flex-col gap-2 pt-3 pb-1.5 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                    <div class="min-w-[200px] flex-1">
                        <h4 class="text-base font-semibold text-white">Drift mode</h4>
                        <p class="mt-0.5 text-sm text-slate-300">
                            Fire a “chaos” routine to stress test commands and log anomalies.
                        </p>
                    </div>
                    <div class="inline-flex w-full items-start justify-start lg:w-auto">
                        <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="button" disabled>
                            Soon
                        </button>
                    </div>
                </li>
                <li class="flex flex-col gap-2 pt-3 pb-1.5 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:justify-between">
                    <div class="min-w-[200px] flex-1">
                        <h4 class="text-base font-semibold text-white">Cache purge</h4>
                        <p class="mt-0.5 text-sm text-slate-300">
                            Flush stale panel caches and refresh runtime keys across all regions.
                        </p>
                    </div>
                    <div class="inline-flex w-full items-start justify-start lg:w-auto">
                        <button class="chip-btn chip-btn-secondary chip-btn-fixed" type="button" disabled>
                            Pending
                        </button>
                    </div>
                </li>
            </ul>
            <p v-if="!actions.length" class="chip-field-hint text-slate-400">
                Add at least one server-side action to unlock the controls above.
            </p>
        </div>

        <transition name="fade">
            <div v-if="showConfirm" class="chip-modal-overlay" @click.self="cancelConfirm">
                <div class="chip-modal chip-stack">
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
