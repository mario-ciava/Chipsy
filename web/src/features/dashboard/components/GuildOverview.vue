<template>
    <section class="chip-card chip-stack" :class="reachCardClass">
        <header class="chip-card__header">
            <div class="chip-stack">
                <div class="flex items-center gap-2">
                    <span class="chip-eyebrow">Connected Discord servers</span>
                    <span
                        class="chip-info-dot"
                        role="img"
                        tabindex="0"
                        aria-label="Guild info"
                        data-tooltip="Active lists managed servers. Available shows where you can invite Chipsy."
                    ></span>
                </div>
                <h3 class="chip-card__title">Guild reach</h3>
                <p class="chip-card__subtitle chip-card__subtitle--tight">
                    Track where the bot already lives and highlight the servers that are ready for an invite.
                </p>
            </div>
        </header>

        <div class="chip-divider chip-divider--strong my-1.5"></div>
        <div v-if="loading" class="grid gap-6 md:grid-cols-2">
            <div
                v-for="index in 2"
                :key="`skeleton-${index}`"
                class="h-20 rounded-full border border-white/10 bg-white/5 animate-pulse"
            ></div>
        </div>
        <div
            v-else
            :class="reachGridClass"
        >
            <div class="chip-stack h-full overflow-hidden">
                <div class="chip-toolbar items-center justify-between gap-3 border-white/10 bg-white/5 shadow-chip-soft">
                    <div class="flex flex-col gap-1">
                        <span class="chip-status__label text-white">Active</span>
                        <span class="chip-field-hint text-xs text-slate-300">
                            Servers currently running Chipsy.
                        </span>
                    </div>
                    <span
                        class="chip-pill chip-pill-metric text-sm"
                        role="status"
                        :aria-label="`Active servers: ${addedGuilds.length}`"
                    >
                        {{ addedGuilds.length }}
                    </span>
                </div>
                <div class="relative flex-1">
                    <ul class="chip-scroll-hidden flex-1 px-4 divide-y divide-white/5" ref="activeList" @scroll="handleScroll('active', $event)">
                    <li
                        v-if="!hasAdded"
                        class="flex min-h-[60px] flex-wrap items-center justify-between gap-3 py-3 text-slate-400"
                        aria-live="polite"
                    >
                        <p class="text-sm">
                            The bot is not active on any managed server.
                        </p>
                        <span class="chip-table__meta text-slate-500">Awaiting activity</span>
                    </li>
                    <template v-else>
                        <li
                            v-for="guild in addedGuilds"
                            :key="guild.id"
                            class="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                            <div>
                                <p class="font-semibold text-white">{{ guild.name }}</p>
                                <span class="chip-table__meta">Live</span>
                            </div>
                            <button
                                v-if="showLeave"
                                type="button"
                                class="chip-btn chip-btn-secondary px-3 py-1 text-xs"
                                :aria-label="`Leave ${guild.name}`"
                                @click="emitLeave(guild.id)"
                            >
                                Leave
                            </button>
                        </li>
                    </template>
                    </ul>
                    <div
                        v-if="showActiveHint"
                        class="chip-scroll-hint"
                        aria-hidden="true"
                    >
                        <span class="chip-scroll-dot"></span>
                        <span class="chip-scroll-dot"></span>
                        <span class="chip-scroll-dot"></span>
                    </div>
                </div>
            </div>
            <div class="chip-stack h-full overflow-hidden">
                <div class="chip-toolbar items-center justify-between gap-3 border-white/10 bg-white/5 shadow-chip-soft">
                    <div class="flex flex-col gap-1">
                        <span class="chip-status__label text-white">Available</span>
                        <span class="chip-field-hint text-xs text-slate-300">
                            Servers ready for a one-click invite.
                        </span>
                    </div>
                    <span
                        class="chip-pill chip-pill-metric text-sm"
                        role="status"
                        :aria-label="`Invite-ready servers: ${availableGuilds.length}`"
                    >
                        {{ availableGuilds.length }}
                    </span>
                </div>
                <div class="relative flex-1">
                    <ul class="chip-scroll-hidden flex-1 px-4 divide-y divide-white/5" ref="availableList" @scroll="handleScroll('available', $event)">
                    <li
                        v-if="!hasAvailable"
                        class="flex min-h-[60px] flex-wrap items-center justify-between gap-3 py-3 text-slate-400"
                        aria-live="polite"
                    >
                        <p class="text-sm text-center">
                            No other servers grant you enough permissions.
                        </p>
                        <span class="chip-table__meta text-slate-500">Permissions required</span>
                    </li>
                    <template v-else>
                        <li
                            v-for="guild in availableGuilds"
                            :key="guild.id"
                            class="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                            <div>
                                <p class="font-semibold text-white">{{ guild.name }}</p>
                                <span class="chip-table__meta">Invite-ready</span>
                            </div>
                            <button
                                type="button"
                                class="chip-btn chip-btn-secondary px-3 py-1 text-xs"
                                :aria-label="`Invite ${guild.name}`"
                                @click="openInvite(guild.id)"
                            >
                                Invite
                            </button>
                        </li>
                    </template>
                    </ul>
                    <div
                        v-if="showAvailableHint"
                        class="chip-scroll-hint"
                        aria-hidden="true"
                    >
                        <span class="chip-scroll-dot"></span>
                        <span class="chip-scroll-dot"></span>
                        <span class="chip-scroll-dot"></span>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<script>
import { getControlPanelRedirect } from "../../../utils/runtime"

const INVITE_BASE = "https://discord.com/api/oauth2/authorize"

const sortGuildsByName = (list) => {
    if (!Array.isArray(list)) return []
    return [...list].sort((guildA, guildB) => {
        const nameA = (guildA?.name || "").toLowerCase()
        const nameB = (guildB?.name || "").toLowerCase()
        if (nameA === nameB) return 0
        return nameA > nameB ? 1 : -1
    })
}
export default {
    name: "GuildOverview",
    props: {
        guilds: {
            type: Object,
            default: () => ({
                added: [],
                available: []
            })
        },
        loading: {
            type: Boolean,
            default: false
        },
        showLeave: {
            type: Boolean,
            default: true
        }
    },
    data() {
        return {
            scrollHints: {
                active: false,
                available: false
            }
        }
    },
    computed: {
        addedGuilds() {
            return sortGuildsByName(this.guilds.added)
        },
        availableGuilds() {
            return sortGuildsByName(this.guilds.available)
        },
        hasAdded() {
            return this.addedGuilds.length > 0
        },
        hasAvailable() {
            return this.availableGuilds.length > 0
        },
        totalGuilds() {
            return this.addedGuilds.length + this.availableGuilds.length
        },
        isReachCompact() {
            return this.totalGuilds < 3
        },
        showActiveHint() {
            return this.scrollHints.active
        },
        showAvailableHint() {
            return this.scrollHints.available
        },
        reachCardClass() {
            return this.isReachCompact ? "min-h-[22rem]" : "h-[30rem]"
        },
        reachGridClass() {
            const base = ["grid", "w-full", "flex-1", "gap-y-10", "md:grid-cols-2", "mx-auto", "overflow-hidden"]
            const spacious = ["max-w-[72rem]", "px-3", "md:px-9", "lg:px-14", "md:gap-x-20", "lg:gap-x-24"]
            const compact = ["max-w-[52rem]", "px-3", "md:px-6", "lg:px-8", "md:gap-x-10", "lg:gap-x-12"]
            return [...base, ...(this.isReachCompact ? compact : spacious)]
        },
        inviteClientId() {
            return process.env.VUE_APP_DISCORD_CLIENT_ID
        },
        inviteRedirect() {
            return encodeURIComponent(getControlPanelRedirect())
        },
        invitePermissions() {
            const value = Number(process.env.VUE_APP_DISCORD_INVITE_PERMISSIONS)
            if (Number.isSafeInteger(value) && value >= 0) {
                return String(value)
            }
            return "2147483648" // Default to admin perms because Discord loves overkill
        },
        inviteState() {
            return "controlPanelInvite"
        }
    },
    watch: {
        addedGuilds: {
            deep: true,
            handler() {
                this.$nextTick(() => this.updateScrollHint("active"))
            }
        },
        availableGuilds: {
            deep: true,
            handler() {
                this.$nextTick(() => this.updateScrollHint("available"))
            }
        }
    },
    mounted() {
        this.$nextTick(() => {
            this.updateScrollHint("active")
            this.updateScrollHint("available")
        })
        window.addEventListener("resize", this.handleResize)
    },
    beforeDestroy() {
        window.removeEventListener("resize", this.handleResize)
    },
    methods: {
        inviteUrl(guildId) {
            if (!this.inviteClientId) return "#"
            return `${INVITE_BASE}?client_id=${this.inviteClientId}&redirect_uri=${this.inviteRedirect}&response_type=code&scope=bot%20applications.commands&permissions=${this.invitePermissions}&guild_id=${guildId}&disable_guild_select=true&state=${this.inviteState}`
        },
        openInvite(guildId) {
            const url = this.inviteUrl(guildId)
            if (url === "#") return
            window.open(url, "_blank", "noopener,noreferrer")
        },
        emitLeave(guildId) {
            this.$emit("leave", guildId)
        },
        handleScroll(type, event) {
            const target = event?.target
            if (!target) return
            const delta = target.scrollHeight - target.scrollTop - target.clientHeight
            this.scrollHints[type] = delta > 12
        },
        updateScrollHint(type) {
            const refs = {
                active: this.$refs.activeList,
                available: this.$refs.availableList
            }
            const target = refs[type]
            if (!target) return
            this.scrollHints[type] = target.scrollHeight > target.clientHeight + 2
        },
        handleResize() {
            this.updateScrollHint("active")
            this.updateScrollHint("available")
        }
    },
}
</script>
