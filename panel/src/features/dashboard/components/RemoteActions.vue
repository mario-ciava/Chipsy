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
        <div class="chip-stack flex-1 overflow-visible">
            <div class="chip-divider chip-divider--strong my-1"></div>
            <div v-if="hasVisibleActions" class="chip-stack gap-6">
                <section
                    v-for="(section, index) in actionSections"
                    :key="section.id"
                    class="chip-stack gap-3"
                >
                    <div v-if="section.label || section.description" class="chip-stack">
                        <div v-if="section.label" class="flex items-center gap-3">
                            <h3 class="chip-card__title">
                                {{ section.label }}
                            </h3>
                        </div>
                        <p
                            v-if="section.description"
                            class="chip-card__subtitle chip-card__subtitle--tight"
                        >
                            {{ section.description }}
                        </p>
                    </div>
                    <ul class="chip-scroll-hidden chip-stack divide-y divide-white/5 flex-1 pr-1">
                        <li
                            v-if="!section.actions.length"
                            class="flex flex-col items-center justify-center gap-2 py-6 text-center text-slate-400"
                        >
                            <span class="text-sm">{{ section.emptyLabel }}</span>
                            <span class="chip-table__meta text-slate-500">{{ section.emptyHint }}</span>
                        </li>
                        <li
                            v-for="action in section.actions"
                            :key="action.id"
                            class="flex flex-col gap-2 pt-3 pb-1.5 first:pt-0 last:pb-0 lg:flex-row lg:items-stretch lg:gap-6 lg:justify-between"
                        >
                            <div class="min-w-[200px] flex-1">
                                <h4 class="text-base font-semibold text-white">
                                    {{ action.label }}
                                </h4>
                                <p class="mt-0.5 text-sm text-slate-300">{{ action.description }}</p>
                                <div
                                    v-if="getActionState(action.id)"
                                    class="mt-2 flex flex-col gap-1 text-xs text-slate-300"
                                >
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span :class="stateToneClass(getActionState(action.id))">
                                            {{ stateLabel(getActionState(action.id)) }}
                                        </span>
                                        <span class="text-[0.7rem] uppercase tracking-[0.25em] text-slate-500">
                                            {{ stateTimestamp(getActionState(action.id)) }}
                                        </span>
                                    </div>
                                    <p class="text-slate-400">
                                        {{ getActionState(action.id).message }}
                                    </p>
                                </div>
                            </div>
                            <div class="inline-flex w-full items-center justify-start gap-2 lg:w-auto lg:self-center lg:justify-end">
                                <button
                                    v-if="action.type === 'command'"
                                    class="chip-btn chip-btn-fixed"
                                    :class="action.dangerous ? 'chip-btn-danger' : 'chip-btn-secondary'"
                                    :disabled="isButtonDisabled()"
                                    @click="handleAction(action)"
                                >
                                    <span v-if="isActionPending(action.id)" class="chip-spinner"></span>
                                    <span v-else>Execute</span>
                                </button>
                                <button v-else class="chip-btn chip-btn-secondary chip-btn-fixed opacity-70" type="button" disabled>
                                    {{ action.pendingLabel || "Soon" }}
                                </button>
                            </div>
                            <div
                                v-if="getActionState(action.id)?.report"
                                class="flex w-full flex-col gap-2"
                            >
                                <button
                                    type="button"
                                    class="chip-btn chip-btn-ghost px-3 py-1 text-xs"
                                    @click="toggleReport(action.id)"
                                >
                                    {{ isReportExpanded(action.id) ? "Hide report" : "View report" }}
                                </button>
                                <div
                                    v-if="isReportExpanded(action.id)"
                                    class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200"
                                >
                                    <div
                                        v-for="service in serviceEntries(getActionState(action.id).report)"
                                        :key="service.id"
                                        class="flex flex-col gap-1 border-b border-white/5 py-2 last:border-b-0"
                                    >
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span class="chip-label text-xs uppercase tracking-wide text-slate-300">
                                                {{ service.label }}
                                            </span>
                                            <span :class="servicePillClass(service.ok)">
                                                {{ service.ok ? "OK" : "CHECK" }}
                                            </span>
                                        </div>
                                        <p class="text-xs text-slate-200">
                                            {{ service.detail }}
                                        </p>
                                        <p v-if="service.hint" class="text-xs text-slate-500">
                                            {{ service.hint }}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </li>
                    </ul>
                    <div
                        v-if="index < actionSections.length - 1"
                        class="chip-divider chip-divider--strong my-1"
                    ></div>
                </section>
            </div>
            <div
                v-else
                class="flex flex-col items-center justify-center gap-2 py-6 text-center text-slate-400"
                aria-live="polite"
            >
                <span class="text-sm">No remote actions are configured yet.</span>
                <span class="chip-table__meta text-slate-500">Awaiting admin setup</span>
            </div>
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
                        <button class="chip-btn chip-btn-danger" @click="proceedConfirm">Confirm</button>
                    </div>
                </div>
            </div>
        </transition>
    </div>
</template>

<script>
import api from "../../../services/api"
import { REMOTE_ACTION_AUDIENCE } from "../../../utils/remoteActions"
import { formatFriendlyDateTime } from "../../../utils/formatters"

export default {
    name: "RemoteActions",
    props: {
        actions: {
            type: Array,
            default: () => []
        },
        visibleActions: {
            type: Array,
            default: null
        }
    },
    data() {
        return {
            pendingActionId: null,
            showConfirm: false,
            pendingAction: null,
            actionStates: {},
            expandedReports: {}
        }
    },
    computed: {
        renderedActions() {
            if (!Array.isArray(this.actions)) {
                return []
            }
            if (!Array.isArray(this.visibleActions) || this.visibleActions.length === 0) {
                return this.actions
            }
            const allow = new Set(this.visibleActions)
            return this.actions.filter((action) => allow.has(action.id))
        },
        adminActions() {
            return this.organizeActionsByAudience(REMOTE_ACTION_AUDIENCE.ADMIN)
        },
        moderationActions() {
            return this.organizeActionsByAudience(REMOTE_ACTION_AUDIENCE.MODERATION)
        },
        actionSections() {
            return [
                {
                    id: REMOTE_ACTION_AUDIENCE.ADMIN,
                    label: null,
                    description: null,
                    emptyLabel: "No admin commands are visible right now.",
                    emptyHint: "Connect with the core API to enable maintenance actions.",
                    actions: this.adminActions
                },
                {
                    id: REMOTE_ACTION_AUDIENCE.MODERATION,
                    label: "Moderation tools",
                    description: "Upcoming helpers for the trusted moderation squad.",
                    emptyLabel: "No moderation tools available.",
                    emptyHint: "Pending rollout for the moderation suite.",
                    actions: this.moderationActions
                }
            ]
        },
        hasVisibleActions() {
            return this.actionSections.some((section) => section.actions.length > 0)
        },
        confirmTitle() {
            if (this.pendingAction?.confirmation?.title) {
                return this.pendingAction.confirmation.title
            }
            return "Confirm action"
        },
        confirmMessage() {
            const confirmation = this.pendingAction?.confirmation || {}
            if (confirmation.stepTwo) {
                return confirmation.stepTwo
            }
            if (confirmation.stepOne) {
                return confirmation.stepOne
            }
            return "Do you actually want to run this?"
        }
    },
    methods: {
        organizeActionsByAudience(audience) {
            const scope = audience || REMOTE_ACTION_AUDIENCE.ADMIN
            const filtered = this.renderedActions.filter(
                (action) => (action.audience || REMOTE_ACTION_AUDIENCE.ADMIN) === scope
            )
            return this.sortActions(filtered)
        },
        sortActions(actions) {
            return actions.slice().sort((a, b) => {
                const weightDiff = this.actionWeight(a) - this.actionWeight(b)
                if (weightDiff !== 0) {
                    return weightDiff
                }
                return this.actionLabelValue(a).localeCompare(this.actionLabelValue(b))
            })
        },
        actionWeight(action) {
            return typeof action?.order === "number" ? action.order : Number.MAX_SAFE_INTEGER
        },
        actionLabelValue(action) {
            return (action?.label || action?.id || "").toString().toLowerCase()
        },
        formatActionLabel(action) {
            if (!action) return "unknown command"
            const label = action.label || action.id || "command"
            const identifier = action.id && action.id !== label ? ` [${action.id}]` : ""
            return `'${label}'${identifier}`
        },
        getActionState(actionId) {
            return this.actionStates[actionId] || null
        },
        stateToneClass(state) {
            if (!state) return "chip-pill chip-pill-ghost"
            if (state.severity === "success") return "chip-pill chip-pill-success"
            if (state.severity === "warning") return "chip-pill chip-pill-warning"
            return "chip-pill chip-pill-danger"
        },
        stateLabel(state) {
            if (!state) return "Pending"
            if (state.severity === "success") return "Success"
            if (state.severity === "warning") return "Needs attention"
            return "Failed"
        },
        stateTimestamp(state) {
            if (!state?.timestamp) return "Just now"
            return formatFriendlyDateTime(state.timestamp)
        },
        serviceEntries(report) {
            if (!report || !report.services) {
                return []
            }
            return Object.entries(report.services).map(([key, details]) => ({
                id: key,
                label: this.resolveServiceLabel(key),
                ok: details?.ok !== false,
                detail: this.resolveServiceDetail(key, details),
                hint: this.resolveServiceHint(key, details)
            }))
        },
        resolveServiceLabel(key) {
            switch (key) {
                case "discord":
                    return "Discord gateway"
                case "mysql":
                    return "MySQL"
                case "cache":
                    return "Cache layer"
                case "status":
                    return "Status snapshot"
                default:
                    return key
            }
        },
        resolveServiceDetail(key, details = {}) {
            if (key === "discord") {
                const status = details.status || "unknown"
                const ping = Number.isFinite(details.ping) ? `${details.ping} ms` : "n/a"
                return `Status ${status} · Ping ${ping}`
            }
            if (key === "mysql") {
                const latency = Number.isFinite(details.latencyMs) ? `${Math.round(details.latencyMs)} ms` : "n/a"
                return details.ok ? `Latency ${latency}` : details.error || "Offline"
            }
            if (key === "cache") {
                const mode = details.mode || "unknown"
                if (details.skipped) {
                    return `Mode ${mode} · skipped`
                }
                return details.ok ? `Mode ${mode}` : details.error || `Mode ${mode}`
            }
            if (key === "status") {
                if (details.skipped) {
                    return "Skipped"
                }
                const enabled = typeof details.enabled === "boolean" ? (details.enabled ? "online" : "offline") : "unknown"
                const guilds = Number.isFinite(details.guildCount) ? `${details.guildCount} guilds` : "guilds n/a"
                return `${enabled} · ${guilds}`
            }
            return details.error || (details.ok ? "Healthy" : "Check")
        },
        resolveServiceHint(key, details = {}) {
            if (key === "discord" && Number.isFinite(details.uptimeMs)) {
                const hours = Math.round(details.uptimeMs / (1000 * 60 * 60))
                return `Uptime ~${hours}h`
            }
            if (details.error) {
                return details.error
            }
            return null
        },
        servicePillClass(ok) {
            return ok ? "chip-pill chip-pill-success" : "chip-pill chip-pill-danger"
        },
        toggleReport(actionId) {
            const current = Boolean(this.expandedReports[actionId])
            this.$set(this.expandedReports, actionId, !current)
        },
        isReportExpanded(actionId) {
            return Boolean(this.expandedReports[actionId])
        },
        recordActionState(actionId, { status, message, report }) {
            const severity = this.resolveSeverity(status)
            const payload = {
                status,
                message,
                report: report || null,
                severity,
                timestamp: new Date().toISOString()
            }
            this.$set(this.actionStates, actionId, payload)
            this.$set(this.expandedReports, actionId, false)
        },
        resolveSeverity(status) {
            if (!status) return "success"
            const normalized = String(status).toLowerCase()
            if (normalized === "ok" || normalized === "success") {
                return "success"
            }
            if (normalized === "degraded" || normalized === "warning") {
                return "warning"
            }
            return "error"
        },
        handleAction(action) {
            if (action.dangerous || action.confirmation) {
                this.pendingAction = action
                this.showConfirm = true
            } else {
                this.executeAction(action)
            }
        },
        proceedConfirm() {
            this.showConfirm = false
            if (this.pendingAction) {
                this.executeAction(this.pendingAction)
            }
        },
        cancelConfirm() {
            this.showConfirm = false
            this.pendingAction = null
        },
        async executeAction(action) {
            if (action.type !== "command") {
                return
            }

            this.pendingActionId = action.id
            try {
                const descriptor = this.formatActionLabel(action)
                const csrfToken = this.$store.state.session.csrfToken
                if (!csrfToken) {
                    throw new Error("Missing authentication token")
                }

                const response = await api.runAdminAction({ csrfToken, actionId: action.id })
                const message = response?.message || `Action ${descriptor} completed successfully.`
                this.recordActionState(action.id, {
                    status: response?.status || "ok",
                    message,
                    report: response?.report
                })
                this.$emit("action-success", {
                    actionId: action.id,
                    message,
                    status: response?.status || "ok",
                    report: response?.report || null
                })
            } catch (error) {
                const descriptor = this.formatActionLabel(action)
                const message =
                    error?.response?.data?.message ||
                    error?.message ||
                    `Action ${descriptor} failed.`
                this.recordActionState(action.id, {
                    status: "error",
                    message
                })
                this.$emit("action-error", {
                    actionId: action.id,
                    message
                })
            } finally {
                if (action === this.pendingAction) {
                    this.pendingAction = null
                }
                this.pendingActionId = null
                this.showConfirm = false
            }
        },
        isActionPending(actionId) {
            return this.pendingActionId === actionId
        },
        isButtonDisabled() {
            return Boolean(this.pendingActionId)
        }
    }
}
</script>
