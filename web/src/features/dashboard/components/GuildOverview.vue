<template>
    <section class="guilds-panel">
        <header class="guilds-panel__header">
            <div>
                <h3 class="guilds-panel__title">Connected Discord servers</h3>
                <p class="guilds-panel__subtitle">
                    Track where the bot already lives and where you still can invite it.
                </p>
            </div>
        </header>

        <div class="guilds-panel__body guilds">
            <article class="guilds__column">
                <div class="guilds__column-header">
                    <div>
                        <h4 class="guilds__title">Active</h4>
                        <p class="guilds__subtitle">Currently connected</p>
                    </div>
                    <span class="guilds__badge">{{ addedGuilds.length }}</span>
                </div>
                <p v-if="!hasAdded" class="guilds__empty">The bot is not active on any managed server.</p>
                <ul v-else class="guilds__list">
                    <li v-for="guild in addedGuilds" :key="guild.id" class="guilds__item">
                        <div class="guilds__info">
                            <span class="guilds__name">{{ guild.name }}</span>
                            <span class="guilds__descriptor">Live</span>
                        </div>
                        <div class="guilds__actions">
                            <button
                                type="button"
                                class="button button--ghost guilds__leave-button"
                                @click="emitLeave(guild.id)"
                            >
                                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path d="M4 9a1 1 0 100 2h12a1 1 0 100-2H4z" />
                                </svg>
                                Leave
                            </button>
                        </div>
                    </li>
                </ul>
            </article>
            <article class="guilds__column">
                <div class="guilds__column-header">
                    <div>
                        <h4 class="guilds__title">Available</h4>
                        <p class="guilds__subtitle">Invite-ready servers</p>
                    </div>
                    <span class="guilds__badge">{{ availableGuilds.length }}</span>
                </div>
                <p v-if="!hasAvailable" class="guilds__empty">
                    No other servers grant you enough permissions.
                </p>
                <ul v-else class="guilds__list">
                    <li v-for="guild in availableGuilds" :key="guild.id" class="guilds__item">
                        <div class="guilds__info">
                            <span class="guilds__name">{{ guild.name }}</span>
                            <span class="guilds__descriptor guilds__descriptor--available">Invite-ready</span>
                        </div>
                        <div class="guilds__actions">
                            <button
                                type="button"
                                class="button button--secondary guilds__invite-button"
                                @click="openInvite(guild.id)"
                            >
                                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                    <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                                </svg>
                                Invite
                            </button>
                        </div>
                    </li>
                </ul>
            </article>
        </div>
    </section>
</template>

<script>
import { getRuntimeOrigin, getControlPanelRedirect } from "../../../utils/runtime"

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
