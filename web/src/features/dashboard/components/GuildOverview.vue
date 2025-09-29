<template>
    <section class="chip-card space-y-6">
        <header class="chip-card__header">
            <div>
                <h3 class="chip-card__title">Connected Discord servers</h3>
                <p class="chip-card__subtitle">
                    Track where the bot already lives and where you still can invite it.
                </p>
            </div>
        </header>

        <div v-if="loading" class="grid gap-4 md:grid-cols-2">
            <div v-for="index in 2" :key="`skeleton-${index}`" class="h-32 rounded-2xl border border-white/10 bg-white/5 animate-pulse"></div>
        </div>
        <div v-else class="grid gap-4 md:grid-cols-2">
            <article class="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h4 class="text-base font-semibold text-white">Active</h4>
                        <p class="text-sm text-slate-400">Currently connected</p>
                    </div>
                    <span class="chip-badge">{{ addedGuilds.length }}</span>
                </div>
                <p v-if="!hasAdded" class="chip-empty mt-4">The bot is not active on any managed server.</p>
                <ul v-else class="mt-4 space-y-3">
                    <li v-for="guild in addedGuilds" :key="guild.id" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                        <div>
                            <p class="font-semibold text-white">{{ guild.name }}</p>
                            <span class="chip-table__meta">Live</span>
                        </div>
                        <button
                            v-if="showLeave"
                            type="button"
                            class="chip-btn chip-btn-ghost px-3 py-1 text-sm"
                            @click="emitLeave(guild.id)"
                        >
                            Leave
                        </button>
                    </li>
                </ul>
            </article>
            <article class="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <h4 class="text-base font-semibold text-white">Available</h4>
                        <p class="text-sm text-slate-400">Invite-ready servers</p>
                    </div>
                    <span class="chip-badge">{{ availableGuilds.length }}</span>
                </div>
                <p v-if="!hasAvailable" class="chip-empty mt-4">
                    No other servers grant you enough permissions.
                </p>
                <ul v-else class="mt-4 space-y-3">
                    <li v-for="guild in availableGuilds" :key="guild.id" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3">
                        <div>
                            <p class="font-semibold text-white">{{ guild.name }}</p>
                            <span class="chip-table__meta">Invite-ready</span>
                        </div>
                        <button
                            type="button"
                            class="chip-btn chip-btn-secondary px-3 py-1 text-sm"
                            @click="openInvite(guild.id)"
                        >
                            Invite
                        </button>
                    </li>
                </ul>
            </article>
        </div>
    </section>
</template>

<script>
import { getControlPanelRedirect } from "../../../utils/runtime"

const INVITE_BASE = "https://discord.com/api/oauth2/authorize"
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
    computed: {
        addedGuilds() {
            return Array.isArray(this.guilds.added) ? this.guilds.added : []
        },
        availableGuilds() {
            return Array.isArray(this.guilds.available) ? this.guilds.available : []
        },
        hasAdded() {
            return this.addedGuilds.length > 0
        },
        hasAvailable() {
            return this.availableGuilds.length > 0
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
        }
    },
}
</script>
