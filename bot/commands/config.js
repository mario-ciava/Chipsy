const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelType,
    Colors,
    MessageFlags
} = require("discord.js")
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const logger = require("../utils/logger")
const { canEditConfig } = require("../utils/canEditConfig")
const { resolveTexasSettings, defaults: texasDefaults } = require("../games/texas/settings")
const { resolveBlackjackSettings, defaults: blackjackDefaults } = require("../games/blackjack/settings")
const GAME_OPTIONS = [
    { id: "texas", label: "Texas Hold'em", emoji: "♠️" },
    { id: "blackjack", label: "Blackjack", emoji: "🃏" }
]

const COMPONENT_IDS = {
    scopeGuild: "cfg_scope_guild",
    scopeChannel: "cfg_scope_channel",
    scopeUser: "cfg_scope_user",
    back: "cfg_scope_back",
    exit: "cfg_exit",
    channelSelect: "cfg_channel_select",
    gameSelect: "cfg_game_select",
    restoreDefaults: "cfg_restore_defaults"
}

const defaultStateForInteraction = () => ({
    scopeType: null,
    scopeId: null,
    gameId: null
})

const fallbackResolution = (gameId) => {
    if (!gameId) return null
    const defaults = gameId === "blackjack" ? resolveBlackjackSettings() : resolveTexasSettings()
    return {
        game: gameId,
        effectiveSettings: defaults,
        layers: {
            defaults,
            guild: {},
            channel: {},
            lobby: {}
        },
        persistentDisabled: false,
        fallback: true
    }
}

const resolveSettingsForState = async(client, interaction, state) => {
    if (!state?.gameId || !state.scopeType) return null
    if (typeof client?.resolveGameSettings !== "function") {
        return fallbackResolution(state.gameId)
    }

    const channelId = state.scopeType === "channel"
        ? state.scopeId
        : interaction.channelId

    try {
        const resolution = await client.resolveGameSettings({
            game: state.gameId,
            guildId: interaction.guildId,
            channelId,
            lobbyOverrides: {}
        })
        return resolution || fallbackResolution(state.gameId)
    } catch (error) {
        logger.warn("Failed to resolve settings for /config", {
            scope: "commands.config",
            game: state.gameId,
            channelId,
            error: error?.message
        })
        return fallbackResolution(state.gameId)
    }
}

const resolveScopeLabel = (state, interaction) => {
    if (state.scopeType === "guild") {
        return `Guild: ${interaction.guild?.name || "Unknown"}`
    }
    if (state.scopeType === "channel") {
        return `Channel: <#${state.scopeId}>`
    }
    if (state.scopeType === "user") {
        const userName = interaction.user?.displayName || interaction.user?.username || "You"
        return `User: ${userName}`
    }
    return "Select a scope"
}

const resolveScopeColor = (scopeType) => {
    if (scopeType === "guild") return Colors.Blurple
    if (scopeType === "channel") return Colors.Green
    if (scopeType === "user") return Colors.Grey
    return Colors.DarkButNotBlack
}

const resolveGameIcon = (gameId) => {
    if (gameId === "blackjack") return "🃏"
    if (gameId === "texas") return "♠️"
    return "⚙️"
}

const resolveValueSource = (key, layers = {}) => {
    if (layers.channel && Object.prototype.hasOwnProperty.call(layers.channel, key)) return "Channel"
    if (layers.guild && Object.prototype.hasOwnProperty.call(layers.guild, key)) return "Guild"
    if (layers.defaults && Object.prototype.hasOwnProperty.call(layers.defaults, key)) return "Default"
    return "—"
}

const formatSeconds = (ms) => {
    if (!Number.isFinite(ms)) return "—"
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `${seconds}s`
}

const buildSettingsEmbed = (state, resolution, interaction, { footerOverride } = {}) => {
    const scopeLabel = resolveScopeLabel(state, interaction)
    const scopeColor = resolveScopeColor(state.scopeType)
    const gameLabel = GAME_OPTIONS.find((g) => g.id === state.gameId)?.label || "Select a game"
    const icon = resolveGameIcon(state.gameId)
    const guildIconURL = state.scopeType === "guild" ? interaction.guild?.iconURL({ size: 64 }) : null
    const userAvatarURL = state.scopeType === "user" ? interaction.user?.displayAvatarURL({ extension: "png", size: 64 }) : null
    const scopeThumbnail = guildIconURL || userAvatarURL
    const botAvatarURL = interaction.client?.user?.displayAvatarURL({ extension: "png", size: 128 })

    if (!state.scopeType) {
        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle("⚙️ Chipsy Config Center")
            .setDescription("Configure game settings for your server or specific channels.\nManage Guild/Channel permissions required to edit.\nChoose a scope below to get started:\n")
            .setThumbnail(botAvatarURL)
            .addFields(
                { name: "🏠 Guild", value: "Server-wide settings", inline: true },
                { name: "💬 Channel", value: "Channel-specific overrides", inline: true },
                { name: "👤 User", value: "Personal preferences", inline: true }
            )
        if (footerOverride) embed.setFooter({ text: footerOverride })
        return embed
    }

    const baseEmbed = new EmbedBuilder().setColor(scopeColor)
    if (scopeThumbnail) baseEmbed.setThumbnail(scopeThumbnail)

    if (!state.gameId || !resolution) {
        let description = "Select a game below to view and edit its settings."
        if (state.scopeType === "guild") {
            description = "Changes here apply to all channels unless overridden.\nSelect a game below to configure."
        } else if (state.scopeType === "channel") {
            description = "Channel overrides take priority over server defaults.\nSelect a game below to configure."
        } else if (state.scopeType === "user") {
            description = `These are your preferences defaults\nServer/channel settings take priority during games.\nSelect a game below to configure.`
        }
        const embed = baseEmbed
            .setTitle(`${icon} Config – ${scopeLabel}`)
            .setDescription(description)
        if (footerOverride) embed.setFooter({ text: footerOverride })
        return embed
    }

    const settings = resolution?.effectiveSettings || {}
    const layers = resolution?.layers || {}
    const sourceFor = (key) => resolveValueSource(key, layers)
    const isUserScope = state.scopeType === "user"

    const rebuyLabel = (() => {
        if (settings.allowRebuyMode === "off") return "Disabled"
        if (settings.allowRebuyMode === "once") return "Allow once"
        return "Enabled"
    })()

    const fields = []

    // Allow game field only for guild/channel scope (not user)
    if (!isUserScope) {
        fields.push({
            name: "🎮 Allow game",
            value: `${settings.enabled === false ? "Disabled" : "Enabled"}\nSource: ${sourceFor("enabled")}`,
            inline: true
        })
    }

    fields.push({
        name: "♻️ Rebuy",
        value: `${rebuyLabel} • ${formatSeconds(settings.rebuyWindowMs)}\nSource: ${sourceFor("allowRebuyMode")}`,
        inline: true
    })

    // Add separator only if we have 2 items in first row
    if (!isUserScope) {
        fields.push({ name: "\u200B", value: "\u200B", inline: false })
    }

    fields.push(
        {
            name: "⏱️ Table speed",
            value: `${formatSeconds(settings.actionTimeoutMs)} per action\nSource: ${sourceFor("actionTimeoutMs")}`,
            inline: true
        },
        {
            name: "🧹 Auto clean",
            value: `${settings.autoCleanHands ? "On" : "Off"}\nSource: ${sourceFor("autoCleanHands")}`,
            inline: true
        }
    )

    const footerText = footerOverride
        || (resolution?.fallback ? "Showing defaults (overrides unavailable)" : "Use the menus below to view or edit settings")

    return new EmbedBuilder()
        .setColor(settings.enabled === false && !isUserScope ? Colors.Red : scopeColor)
        .setTitle(`${icon} Config – ${gameLabel} – ${scopeLabel}`)
        .setThumbnail(scopeThumbnail)
        .addFields(fields)
        .setFooter({ text: footerText })
}

const buildScopeButtons = (state, permissions) => {
    const buttons = [
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.scopeGuild)
            .setStyle(ButtonStyle.Primary) // blue
            .setLabel("Guild")
            .setDisabled(!permissions.guild.allowed),
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.scopeChannel)
            .setStyle(ButtonStyle.Success) // green
            .setLabel("Channel")
            .setDisabled(!permissions.channel.allowed),
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.scopeUser)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("User"),
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.restoreDefaults)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("🔄 Restore Defaults")
            .setDisabled(!permissions.guild.allowed),
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.exit)
            .setStyle(ButtonStyle.Danger)
            .setLabel("Exit")
            .setEmoji("🚪")
    ]
    return new ActionRowBuilder().addComponents(buttons)
}

const buildBackButton = () => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.back)
            .setStyle(ButtonStyle.Secondary)
            .setLabel("⬅️ Back"),
        new ButtonBuilder()
            .setCustomId(COMPONENT_IDS.exit)
            .setStyle(ButtonStyle.Danger)
            .setLabel("Exit")
            .setEmoji("🚪")
    )
}

const buildChannelSelectRow = (state, permissions, channels = []) => {
    if (!channels.length || !permissions.channel.allowed) return null
    const select = new StringSelectMenuBuilder()
        .setCustomId(COMPONENT_IDS.channelSelect)
        .setPlaceholder(channels.find((c) => c.value === state.scopeId)?.label || "Select a channel")
        .setMinValues(1)
        .setMaxValues(1)
        .setDisabled(state.scopeType !== "channel")
    channels.forEach((channel) => {
        select.addOptions({
            label: channel.label,
            value: channel.value,
            default: state.scopeType === "channel" && state.scopeId === channel.value
        })
    })
    return new ActionRowBuilder().addComponents(select)
}

const buildGameSelectRow = (state) => {
    const select = new StringSelectMenuBuilder()
        .setCustomId(COMPONENT_IDS.gameSelect)
        .setPlaceholder(`Game: ${GAME_OPTIONS.find((g) => g.id === state.gameId)?.label || "Select a game"}`)
        .setMinValues(1)
        .setMaxValues(1)
    GAME_OPTIONS.forEach((option) => {
        select.addOptions({
            label: `Game: ${option.label}`,
            value: option.id,
            emoji: option.emoji,
            default: state.gameId === option.id
        })
    })
    return new ActionRowBuilder().addComponents(select)
}

const resolveChannelOptions = (guild) => {
    if (!guild?.channels?.cache) return []
    return Array.from(
        guild.channels.cache
            .filter((channel) => channel.type === ChannelType.GuildText && channel.viewable)
            .values()
    )
        .sort((a, b) => a.rawPosition - b.rawPosition || a.name.localeCompare(b.name))
        .slice(0, 25)
        .map((channel) => ({
            label: `Channel: #${channel.name}`,
            value: channel.id
        }))
}

const resolveActionTimeoutOptions = (gameId, settings = {}) => {
    const baseOptions = [15, 30, 45, 60, 75, 90, 120, 180, 240]
    const defaults = gameId === "blackjack" ? blackjackDefaults : texasDefaults
    const min = Number.isFinite(settings.minActionTimeoutMs) ? settings.minActionTimeoutMs : defaults.minActionTimeoutMs
    const max = Number.isFinite(settings.maxActionTimeoutMs) ? settings.maxActionTimeoutMs : defaults.maxActionTimeoutMs
    const filtered = baseOptions.filter((sec) => (sec * 1000) >= min && (sec * 1000) <= max)
    const unique = Array.from(new Set(filtered.length ? filtered : baseOptions))
    return { options: unique, min, max }
}

const buildSettingSelects = (state, resolution, permissions) => {
    if (!state.gameId || !resolution) return []
    const settings = resolution?.effectiveSettings || {}
    const layers = resolution?.layers || {}
    const gameId = state.gameId
    // User scope is always editable (personal preferences), guild/channel require permissions
    const editable = state.scopeType === "user" ? true : Boolean(permissions[state.scopeType]?.allowed)

    const selectStatus = new StringSelectMenuBuilder()
        .setCustomId(`cfg:${gameId}:${state.scopeType}:enabled`)
        .setPlaceholder(`Allow game — ${settings.enabled === false ? "Disabled" : "Enabled"}`)
        .setDisabled(!editable)
        .addOptions(
            { label: "Allow game", value: "allowed", default: settings.enabled !== false, emoji: "✅" },
            { label: "Disable game", value: "disallowed", default: settings.enabled === false, emoji: "⛔" },
            { label: "Reset to lower scope", value: "reset", emoji: "♻️" }
        )

    const selectRebuy = new StringSelectMenuBuilder()
        .setCustomId(`cfg:${gameId}:${state.scopeType}:allowRebuyMode`)
        .setPlaceholder(`Rebuy — ${settings.allowRebuyMode || "—"} (Source: ${resolveValueSource("allowRebuyMode", layers)})`)
        .setDisabled(!editable)
        .addOptions(
            { label: "Allow rebuy", value: "on", default: settings.allowRebuyMode === "on", emoji: "✅" },
            { label: "Allow once", value: "once", default: settings.allowRebuyMode === "once", emoji: "1️⃣" },
            { label: "Disable rebuy", value: "off", default: settings.allowRebuyMode === "off", emoji: "⛔" },
            { label: "Reset to lower scope", value: "reset", emoji: "♻️" }
        )

    const actionTimeoutMeta = resolveActionTimeoutOptions(gameId, {
        minActionTimeoutMs: layers?.defaults?.minActionTimeoutMs ?? settings.minActionTimeoutMs,
        maxActionTimeoutMs: layers?.defaults?.maxActionTimeoutMs ?? settings.maxActionTimeoutMs
    })
    const currentSeconds = Math.round((settings.actionTimeoutMs || 0) / 1000)
    const selectSpeed = new StringSelectMenuBuilder()
        .setCustomId(`cfg:${gameId}:${state.scopeType}:actionTimeoutMs`)
        .setPlaceholder(`Table speed — ${currentSeconds || "?"}s per action (Source: ${resolveValueSource("actionTimeoutMs", layers)})`)
        .setDisabled(!editable)
        .addOptions(
            actionTimeoutMeta.options.map((sec) => ({
                label: `⏱️ ${sec}s per action`,
                value: String(sec),
                default: currentSeconds === sec
            })).concat({ label: "Reset to lower scope", value: "reset", emoji: "♻️" })
        )

    const selectClean = new StringSelectMenuBuilder()
        .setCustomId(`cfg:${gameId}:${state.scopeType}:autoCleanHands`)
        .setPlaceholder(`Auto clean — ${settings.autoCleanHands ? "On" : "Off"} (Source: ${resolveValueSource("autoCleanHands", layers)})`)
        .setDisabled(!editable)
        .addOptions(
            { label: "Auto clean - On", value: "on", default: settings.autoCleanHands === true, emoji: "✅" },
            { label: "Auto clean - Off", value: "off", default: settings.autoCleanHands !== true, emoji: "⛔" },
            { label: "Reset to lower scope", value: "reset", emoji: "♻️" }
        )

    const rows = []

    // Allow game select only for guild/channel scope (not user)
    if (state.scopeType !== "user") {
        rows.push(new ActionRowBuilder().addComponents(selectStatus))
    }

    rows.push(
        new ActionRowBuilder().addComponents(selectRebuy),
        new ActionRowBuilder().addComponents(selectSpeed),
        new ActionRowBuilder().addComponents(selectClean)
    )

    return rows
}

const buildComponents = (state, permissions, guild, resolution) => {
    const scopeChosen = Boolean(state.scopeType)
    if (!scopeChosen) {
        return [buildScopeButtons(state, permissions)]
    }

    const rows = []

    // Once a game is selected, hide navigation selects to stay within Discord's 5 ActionRow limit.
    // The selected channel/game is shown in the embed title; use Back to change.
    const gameSelected = Boolean(state.gameId)

    if (!gameSelected && state.scopeType === "channel") {
        const channelOptions = resolveChannelOptions(guild)
        const channelRow = buildChannelSelectRow(state, permissions, channelOptions)
        if (channelRow) rows.push(channelRow)
    }

    if (!gameSelected) {
        rows.push(buildGameSelectRow(state))
    }

    rows.push(...buildSettingSelects(state, resolution, permissions))
    rows.push(buildBackButton())

    return rows
}

const normalizeOverridePayload = ({ key, value, gameId }) => {
    if (key === "enabled") {
        if (value === "allowed") return { key: "enabled", value: true }
        if (value === "disallowed") return { key: "enabled", value: false }
    }
    if (key === "allowRebuyMode") {
        if (value === "on" || value === "once" || value === "off") {
            return { key: "allowRebuyMode", value }
        }
    }
    if (key === "actionTimeoutMs") {
        const seconds = Number(value)
        if (Number.isFinite(seconds) && seconds > 0) {
            return { key: "actionTimeoutMs", value: seconds * 1000 }
        }
    }
    if (key === "autoCleanHands") {
        if (value === "on") return { key: "autoCleanHands", value: true }
        if (value === "off") return { key: "autoCleanHands", value: false }
    }
    return null
}

const handleOverrideUpdate = async({
    interaction,
    client,
    state,
    selectedKey,
    selectedValue,
    permissions
}) => {
    const respond = interaction.deferred || interaction.replied
        ? interaction.followUp.bind(interaction)
        : interaction.reply.bind(interaction)

    const settingsStore = client?.settingsStore
    if (!settingsStore) {
        await respond({
            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Settings store unavailable. Please try again later.")],
            flags: MessageFlags.Ephemeral
        }).catch(() => null)
        return null
    }

    // User scope is always allowed (personal preferences), guild/channel require permissions
    if (state.scopeType !== "user" && !permissions[state.scopeType]?.allowed) {
        await respond({
            embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are not allowed to edit this scope.")],
            flags: MessageFlags.Ephemeral
        }).catch(() => null)
        return null
    }

    const isReset = selectedValue === "reset"
    const payload = normalizeOverridePayload({ key: selectedKey, value: selectedValue, gameId: state.gameId })

    try {
        if (isReset) {
            await settingsStore.clearOverride({
                scopeType: state.scopeType,
                scopeId: state.scopeId,
                game: state.gameId,
                key: selectedKey
            })
        } else if (payload) {
            await settingsStore.setOverride({
                scopeType: state.scopeType,
                scopeId: state.scopeId,
                game: state.gameId,
                key: payload.key,
                value: payload.value,
                actorId: interaction.user.id
            })
        } else {
            await respond({
                embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ Invalid selection.")],
                flags: MessageFlags.Ephemeral
            }).catch(() => null)
            return null
        }
    } catch (error) {
        logger.error("Failed to persist config override", {
            scope: "commands.config",
            key: selectedKey,
            value: selectedValue,
            error: error?.message
        })
        await respond({
            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Failed to save the setting. Please try again.")],
            flags: MessageFlags.Ephemeral
        }).catch(() => null)
        return null
    }

    return client.resolveGameSettings({
        game: state.gameId,
        guildId: interaction.guildId,
        channelId: state.scopeType === "channel" ? state.scopeId : interaction.channelId,
        lobbyOverrides: {}
    })
}

const runConfigCommand = async(interaction, client) => {
    const permissions = {
        guild: canEditConfig({ scopeType: "guild", user: interaction.user, guild: interaction.guild, channel: interaction.channel, member: interaction.member }),
        channel: canEditConfig({ scopeType: "channel", user: interaction.user, guild: interaction.guild, channel: interaction.channel, member: interaction.member })
    }

    const state = defaultStateForInteraction()
    let resolution = null
    let footerMessage = null

    const buildView = (currentResolution) => ({
        embeds: [buildSettingsEmbed(state, currentResolution, interaction, { footerOverride: footerMessage })],
        components: buildComponents(state, permissions, interaction.guild, currentResolution)
    })

    const initialView = buildView(resolution)
    await sendInteractionResponse(interaction, {
        ...initialView,
        flags: MessageFlags.Ephemeral
    })

    let responseMessage = null
    if (typeof interaction.fetchReply === "function") {
        try {
            responseMessage = await interaction.fetchReply()
        } catch (error) {
            logger.warn("Failed to fetch /config reply for collector", {
                scope: "commands.config",
                error: error?.message
            })
        }
    }

    if (!responseMessage) {
        await interaction.followUp({
            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to open the configuration panel. Please try again.")],
            flags: MessageFlags.Ephemeral
        }).catch(() => null)
        return
    }

    const collector = responseMessage?.createMessageComponentCollector?.({
        time: 5 * 60 * 1000,
        filter: (i) => i.user.id === interaction.user.id
    })

    if (!collector) return

    collector.on("collect", async(i) => {
        try {
            const responder = i.deferred || i.replied ? i.followUp.bind(i) : i.reply.bind(i)
            let shouldRefresh = false

            if (i.customId === COMPONENT_IDS.scopeGuild) {
                if (!permissions.guild.allowed) {
                    await responder({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription(permissions.guild.reason || "You cannot view guild settings.")], flags: MessageFlags.Ephemeral }).catch(() => null)
                    return
                }
                state.scopeType = "guild"
                state.scopeId = interaction.guildId
                shouldRefresh = true
            } else if (i.customId === COMPONENT_IDS.scopeChannel) {
                if (!permissions.channel.allowed) {
                    await responder({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription(permissions.channel.reason || "You cannot view channel settings.")], flags: MessageFlags.Ephemeral }).catch(() => null)
                    return
                }
                state.scopeType = "channel"
                state.scopeId = interaction.channelId
                shouldRefresh = true
            } else if (i.customId === COMPONENT_IDS.scopeUser) {
                state.scopeType = "user"
                state.scopeId = interaction.user.id
                shouldRefresh = true
            } else if (i.customId === COMPONENT_IDS.restoreDefaults) {
                if (!permissions.guild.allowed) {
                    await responder({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You need Manage Guild permission to restore defaults.")], flags: MessageFlags.Ephemeral }).catch(() => null)
                    return
                }
                const settingsStore = client?.settingsStore
                if (settingsStore) {
                    try {
                        // Clear all guild and channel overrides for all games
                        for (const game of GAME_OPTIONS) {
                            await settingsStore.clearOverride({ scopeType: "guild", scopeId: interaction.guildId, game: game.id })
                            // Clear channel overrides for all visible channels
                            const channels = interaction.guild?.channels?.cache?.filter((ch) => ch.isTextBased()) || []
                            for (const [channelId] of channels) {
                                await settingsStore.clearOverride({ scopeType: "channel", scopeId: channelId, game: game.id })
                            }
                        }
                        footerMessage = "✅ All server and channel settings have been restored to defaults."
                    } catch (error) {
                        logger.error("Failed to restore defaults", { scope: "commands.config", error: error?.message })
                        footerMessage = "❌ Failed to restore defaults. Please try again."
                    }
                }
                shouldRefresh = true
            } else if (i.customId === COMPONENT_IDS.back) {
                Object.assign(state, defaultStateForInteraction())
                resolution = null
                shouldRefresh = true
            } else if (i.customId === COMPONENT_IDS.exit) {
                await i.deferUpdate().catch(() => null)
                if (collector && !collector.ended) collector.stop("exit")
                await interaction.deleteReply().catch(() => null)
                return
            } else if (i.customId === COMPONENT_IDS.channelSelect) {
                const selectedChannel = Array.isArray(i.values) ? i.values[0] : i.values
                if (selectedChannel) {
                    state.scopeType = "channel"
                    state.scopeId = selectedChannel
                    shouldRefresh = true
                }
            } else if (i.customId === COMPONENT_IDS.gameSelect) {
                const selectedGame = Array.isArray(i.values) ? i.values[0] : i.values
                if (selectedGame) {
                    state.gameId = selectedGame
                    shouldRefresh = true
                }
            } else if (i.customId.startsWith("cfg:")) {
                const parts = i.customId.split(":")
                const key = parts[3]
                const value = Array.isArray(i.values) ? i.values[0] : i.values
                const nextResolution = await handleOverrideUpdate({
                    interaction: i,
                    client,
                    state,
                    selectedKey: key,
                    selectedValue: value,
                    permissions
                })
                if (nextResolution) {
                    resolution = nextResolution
                    shouldRefresh = true
                }
            }

            const nextResolution = shouldRefresh
                ? await (async() => {
                    if (!state.gameId || !state.scopeType) return fallbackResolution(state.gameId)
                    try {
                        return await resolveSettingsForState(client, interaction, state) || fallbackResolution(state.gameId)
                    } catch (error) {
                        logger.warn("Failed to resolve settings in collector", {
                            scope: "commands.config",
                            error: error?.message
                        })
                        return fallbackResolution(state.gameId)
                    }
                })()
                : resolution
            resolution = nextResolution
            const view = buildView(resolution)
            if (shouldRefresh) {
                if (i.deferred || i.replied) {
                    await i.editReply(view).catch(() => null)
                } else {
                    await i.update(view).catch(() => null)
                }
            } else if (!i.deferred && !i.replied) {
                await i.deferUpdate().catch(() => null)
            }

        } catch (error) {
            logger.error("Failed to update /config view", {
                scope: "commands.config",
                error: error?.message
            })
            if (i.deferred || i.replied) {
                await i.editReply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to refresh the configuration view. Please try again.")],
                    components: [],
                    flags: MessageFlags.Ephemeral
                }).catch(() => null)
            } else {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to refresh the configuration view. Please try again.")],
                    flags: MessageFlags.Ephemeral
                }).catch(() => null)
            }
        }
    })

    collector.on("end", async() => {
        try {
            await responseMessage.edit({ components: [] })
        } catch (error) {
            logger.warn("Failed to disable /config components after collector end", {
                scope: "commands.config",
                error: error?.message
            })
        }
    })
}

const slashCommand = new SlashCommandBuilder()
    .setName("config")
    .setDescription("View Chipsy configuration for Texas Hold'em and Blackjack.")

module.exports = createCommand({
    name: "config",
    description: "View Chipsy configuration.",
    slashCommand,
    data: slashCommand,
    defer: false,
    deferEphemeral: true,
    skipUserData: true,
    execute: runConfigCommand
})
