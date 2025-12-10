const { SlashCommandBuilder, EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, MessageFlags, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js")
const { randomUUID } = require("node:crypto")
const BlackJack = require("../games/blackjack/blackjackGame.js")
const features = require("../../shared/features")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession, registerActiveSession, getActiveSession, registerPublicLobby, unregisterPublicLobby, updateLobbyPlayerCount, cleanupExpiredLobbies, findPublicLobbies, countUserPublicLobbies } = require("../lobbies")
const { resolveBlackjackSettings, defaults: blackjackSettingDefaults } = require("../games/blackjack/settings")
const config = require("../../config")

const AUTO_START_DELAY_MS = config.lobby.autoStartDelay.default
const MIN_PLAYERS_TO_START = Math.max(1, Number(config.blackjack.minPlayers?.default) || 1)
const BLACKJACK_DEFAULT_MIN_BET = config.blackjack?.minBet?.default ?? 100
const BLACKJACK_DEFAULT_MAX_PLAYERS = config.blackjack?.maxPlayersDefault?.default ?? 7
const DEFAULT_PUBLIC_LOBBY_TTL_MS = 30 * 60 * 1000
const MAX_PUBLIC_LOBBIES_PER_USER = 1

const buildCommandInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "commands.blackjack",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const buildStopLogHandler = (channelId, reason) => (error) => {
    logger.warn("Failed to stop blackjack game", {
        scope: "commands.blackjack",
        channelId,
        reason,
        error: error?.message
    })
    return null
}

const resolveLobbyStackValue = (player) => {
    if (!player) return 0
    if (Number.isFinite(player.stack) && player.stack > 0) return player.stack
    if (Number.isFinite(player.pendingBuyIn) && player.pendingBuyIn > 0) return player.pendingBuyIn
    if (Number.isFinite(player.buyInAmount) && player.buyInAmount > 0) return player.buyInAmount
    return 0
}

/**
 * Run blackjack game - uses Discord.js native interaction API.
 * Clean, simple, no abstractions.
 */
const runBlackjack = async(interaction, client) => {
    const channel = interaction.channel

    const replyOrEdit = (payload = {}) => {
        const finalPayload = payload.allowedMentions
            ? payload
            : { ...payload, allowedMentions: { parse: [] } }
        return sendInteractionResponse(interaction, finalPayload)
    }

    const logLobbyInteraction = (component, message, extra = {}) =>
        buildCommandInteractionLog(component, message, { phase: "lobby", ...extra })

    if (channel.__blackjackStarting) {
        await replyOrEdit({
            embeds: [new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${interaction.user.tag}, please wait: a blackjack game is already being initialized.`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    if (channel.game) {
        await replyOrEdit({
            embeds: [new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({
                    text: `${interaction.user.tag}, access denied: a game is already existing in this channel`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    channel.__blackjackStarting = true

    let game = null
    let lobbyOverrides = {}
    let settingsLayers = {
        defaults: resolveBlackjackSettings(),
        guild: {},
        channel: {}
    }
    let settingsResolution = null

    const mergeSettings = (overrides = lobbyOverrides) => {
        if (typeof client?.mergeGameSettingsLayers === "function") {
            settingsResolution = client.mergeGameSettingsLayers({
                game: "blackjack",
                layers: settingsLayers,
                lobbyOverrides: overrides
            })
        } else {
            const persistentDisabled = settingsLayers.guild?.enabled === false || settingsLayers.channel?.enabled === false
            const mergedOverrides = {
                ...settingsLayers.defaults,
                ...settingsLayers.guild,
                ...settingsLayers.channel,
                ...overrides
            }
            const effectiveSettings = resolveBlackjackSettings({ overrides: mergedOverrides })
            if (persistentDisabled) {
                effectiveSettings.enabled = false
            }
            settingsResolution = {
                game: "blackjack",
                effectiveSettings,
                layers: {
                    defaults: settingsLayers.defaults,
                    guild: settingsLayers.guild,
                    channel: settingsLayers.channel,
                    lobby: { ...overrides }
                },
                persistentDisabled
            }
        }
        return settingsResolution
    }

    const sanitizeVisibility = (value = "private") => {
        const normalized = String(value || "").trim().toLowerCase()
        return normalized === "public" ? "public" : "private"
    }

    const promptLobbyIntent = async() => {
        const thumbnail = new AttachmentBuilder('./assets/ui/Lobby.png')
        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle("🃏 Blackjack | Lobby Setup")
            .setDescription("What would you like to do? Please choose an option below to get started.")
            .setThumbnail('attachment://Lobby.png')

        const components = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("bj:init:create")
                    .setLabel("Create New Lobby")
                    .setEmoji("🆕")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("bj:init:browse")
                    .setLabel("Search Open Lobbies")
                    .setEmoji("🔍")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId("bj:init:exit")
                    .setLabel("Exit")
                    .setEmoji("🚪")
                    .setStyle(ButtonStyle.Danger)
            )
        ]

        const promptMessage = await replyOrEdit({
            embeds: [embed],
            components,
            files: [thumbnail],
            flags: MessageFlags.Ephemeral,
            fetchReply: true
        })

        return new Promise((resolve) => {
            let isResolved = false
            const collector = promptMessage.createMessageComponentCollector({
                time: config.lobby.collectorTimeout.default,
                filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("bj:init:")
            })

            collector.on('collect', async (selection) => {
                if (isResolved) return

                if (selection.customId === "bj:init:browse") {
                    await selection.deferUpdate()
                    let lobbies = []
                    try {
                        lobbies = await findPublicLobbies({ pool: client.connection, game: 'blackjack', limit: 25 })
                    } catch (err) {
                        logger.error("Failed to fetch public lobbies", { scope: "blackjack", error: err.message })
                    }

                    if (lobbies.length === 0) {
                        await interaction.followUp({
                            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ No public lobbies found. Create one!")],
                            flags: MessageFlags.Ephemeral
                        })
                        return
                    }

                    const select = new StringSelectMenuBuilder()
                       .setCustomId("bj:init:select")
                       .setPlaceholder("Select a lobby to join...")
                       .addOptions(lobbies.map(l => ({
                           label: `Min $${setSeparator(l.min_bet)} • ${l.current_players}/${l.max_players} players`,
                           description: `Host: ${l.host_name || 'Unknown'}`,
                           value: l.id
                       })))

                    await interaction.editReply({
                        content: null,
                        embeds: [new EmbedBuilder().setColor(Colors.Blue).setTitle("🔍 Open Blackjack Lobbies")],
                        components: [new ActionRowBuilder().addComponents(select)]
                    })
                }
                else if (selection.customId === "bj:init:select") {
                     await selection.deferUpdate()
                     isResolved = true
                     collector.stop()
                     resolve({ intent: "join", lobbyId: selection.values[0] })
                }
                else if (selection.customId === "bj:init:exit") {
                    await selection.deferUpdate()
                    isResolved = true
                    collector.stop()
                    await interaction.deleteReply().catch(() => null)
                    resolve(null)
                }
                else if (selection.customId === "bj:init:create") {
                    const modalCustomId = `bj:create:${selection.id}`
                    const modal = new ModalBuilder()
                        .setCustomId(modalCustomId)
                        .setTitle("Create Blackjack Lobby")
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId("minBet")
                                    .setLabel("Minimum Bet")
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                                    .setValue(String(BLACKJACK_DEFAULT_MIN_BET))
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId("maxPlayers")
                                    .setLabel("Max Players (1-7)")
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(false)
                                    .setPlaceholder(String(BLACKJACK_DEFAULT_MAX_PLAYERS))
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId("visibility")
                                    .setLabel("Lobby Visibility (public/private)")
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(false)
                                    .setPlaceholder("private")
                            )
                        )

                    try {
                        await selection.showModal(modal)
                    } catch (error) {
                        logger.warn("Failed to show Blackjack lobby creation modal", {
                            scope: "commands.blackjack",
                            error: error?.message
                        })
                        return
                    }

                    try {
                        const submission = await selection.awaitModalSubmit({
                            time: config.lobby.modalTimeout.default,
                            filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id
                        })
                        
                        const minBetRaw = submission.fields.getTextInputValue("minBet")?.trim() || String(BLACKJACK_DEFAULT_MIN_BET)
                        const maxPlayersRaw = submission.fields.getTextInputValue("maxPlayers")?.trim()
                        const maxPlayersInput = maxPlayersRaw ? Number.parseInt(maxPlayersRaw, 10) : null
                        const visibility = sanitizeVisibility(submission.fields.getTextInputValue("visibility") || "private")

                        await submission.deferUpdate().catch(() => null)
                        
                        isResolved = true
                        collector.stop()
                        resolve({ intent: "create", minBetRaw, maxPlayersInput, visibility })
                    } catch (error) {
                        // Modal cancelled or timed out.
                        // User can click button again.
                    }
                }
            })

            collector.on('end', (_, reason) => {
                if (!isResolved) {
                    if (reason === 'time') {
                        promptMessage.edit({
                            embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⌛ Lobby setup expired. Please run `/blackjack` again.")],
                            components: []
                        }).catch(() => null)
                    }
                    resolve(null)
                }
            })
        })
    }

    try {
        const lobbyInput = await promptLobbyIntent()
        if (!lobbyInput) {
             if (channel.__blackjackStarting) channel.__blackjackStarting = false
             return
        }

        // Delete the ephemeral prompt
        await interaction.deleteReply().catch(() => null)

        if (lobbyInput.intent === "join") {
            const activeSession = getActiveSession(lobbyInput.lobbyId)
            if (!activeSession) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ That lobby is no longer active or could not be found.")],
                    flags: MessageFlags.Ephemeral
                })
                channel.__blackjackStarting = false
                return
            }

            const mirrorMessage = await activeSession.addMirror(channel)
            if (!mirrorMessage) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Failed to join lobby view. Check bot permissions.")],
                    flags: MessageFlags.Ephemeral
                })
            }
            channel.__blackjackStarting = false
            return
        }

        const minBetRaw = lobbyInput.minBetRaw
        const maxPlayersInput = lobbyInput.maxPlayersInput
        const lobbyVisibility = sanitizeVisibility(lobbyInput.visibility)
        const isPublicLobby = lobbyVisibility === "public"
        const pool = client?.connection

        if (isPublicLobby) {
            const currentCount = await countUserPublicLobbies(pool, interaction.user.id)
            if (currentCount >= MAX_PUBLIC_LOBBIES_PER_USER) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ You already have ${currentCount} active public lobby. Please close it before creating a new one.`)],
                    flags: MessageFlags.Ephemeral
                })
                channel.__blackjackStarting = false
                return
            }
        }

        // Convert minBet (supports "1k", "1m" etc)
        const minBet = features.inputConverter(minBetRaw)

        // Validation
        if (!Number.isFinite(minBet) || minBet <= 0) {
            await interaction.followUp({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${interaction.user.tag}, minimum bet must be a positive number.`)],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const minPlayersAllowed = config.blackjack?.minPlayers?.default ?? 1
        const maxPlayersAllowed = config.blackjack?.maxPlayersDefault?.default ?? BLACKJACK_DEFAULT_MAX_PLAYERS
        const normalizedMaxPlayers = Number.isInteger(maxPlayersInput)
            ? Math.min(Math.max(maxPlayersInput, minPlayersAllowed), maxPlayersAllowed)
            : maxPlayersAllowed

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating BlackJack game", {
            scope: "commands",
            command: "blackjack",
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            channelId: channel.id
        })

        if (typeof client?.resolveGameSettings === "function") {
            try {
                const resolved = await client.resolveGameSettings({
                    game: "blackjack",
                    guildId: interaction.guildId,
                    channelId: interaction.channelId,
                    lobbyOverrides
                })
                settingsLayers = {
                    defaults: resolved.layers?.defaults || settingsLayers.defaults,
                    guild: resolved.layers?.guild || {},
                    channel: resolved.layers?.channel || {}
                }
                lobbyOverrides = resolved.layers?.lobby || lobbyOverrides
                settingsResolution = resolved
            } catch (error) {
                logger.warn("Failed to resolve persisted Blackjack settings", {
                    scope: "commands.blackjack",
                    channelId: interaction.channelId,
                    error: error?.message
                })
            }
        }

        if (!settingsResolution) {
            settingsResolution = mergeSettings(lobbyOverrides)
        }

        if (settingsResolution?.effectiveSettings?.enabled === false) {
            const disabledInChannel = settingsResolution.layers?.channel?.enabled === false
            const disabledInGuild = settingsResolution.layers?.guild?.enabled === false
            const scopeText = disabledInChannel ? "this channel" : disabledInGuild ? "this server" : "this channel or server"
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setTitle("🃏 Blackjack Disabled")
                .setDescription(`Blackjack is disabled in ${scopeText}.\nAsk an administrator to enable it via \\\`/config\\\`.`)
            await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral })
            return
        }

        // Create message adapter for game (game code expects this format)
        const messageAdapter = {
            author: interaction.user,
            channel: interaction.channel,
            client
        }

        const effectiveSettings = settingsResolution?.effectiveSettings || resolveBlackjackSettings({ overrides: lobbyOverrides })

        channel.game = new BlackJack({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            maxBuyIn,
            settings: effectiveSettings
        });
        registerGame(client, channel.game)
        game = channel.game

        if (typeof game.setRemoteMeta === "function") {
            const hostAvatar = typeof interaction.user.displayAvatarURL === "function"
                ? interaction.user.displayAvatarURL({ extension: "png", size: 64 })
                : null
            game.setRemoteMeta({
                label: "Blackjack",
                type: "blackjack",
                origin: "command:blackjack",
                host: {
                    id: interaction.user.id,
                    tag: interaction.user.tag,
                    username: interaction.user.username,
                    avatar: hostAvatar
                },
                channelId: channel.id,
                channelName: channel.name,
                guildId: channel.guild?.id,
                guildName: channel.guild?.name,
                turnTimeoutMs: game.actionTimeoutMs || config.blackjack.actionTimeout.default
            })
        }

        const lobbyId = game.remoteControl?.id || `blackjack-${(randomUUID ? randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)}`
        const hostId = interaction.user.id
        const hostMention = hostId ? `<@${hostId}>` : interaction.user.tag

        const resolveGameContext = () => channel.game ?? game

        const formatPlayers = () => {
            const ctx = resolveGameContext()
            const players = ctx?.players || []
            if (!players.length) return "—"
            return players
                .map((player) => {
                    const mention = player?.id ? `<@${player.id}>` : String(player)
                    const stack = setSeparator(resolveLobbyStackValue(player))
                    return `${mention} - ${stack}$`
                })
                .join("\n")
        }

        const statusConfig = {
            waiting: {
                color: Colors.Green,
                footer: "Waiting for players…"
            },
            starting: {
                color: Colors.Blurple,
                footer: "Starting the game…"
            },
            canceled: {
                color: Colors.Red,
                footer: "Game canceled."
            },
            ended: {
                color: Colors.DarkGrey,
                footer: "Game ended."
            }
        }

        const renderLobbyView = ({ state, manager }) => {
            const lobbyStateOverrides = state?.settings || lobbyOverrides
            const resolution = mergeSettings(lobbyStateOverrides)
            const ctx = resolveGameContext()
            const players = ctx?.players || []
            const maxPlayersLimit = Number.isFinite(ctx?.maxPlayers) && ctx.maxPlayers > 0
                ? ctx.maxPlayers
                : null
            const palette = statusConfig[state.status] || statusConfig.waiting
            const footerText = state.footerText || palette.footer
            const playing = Boolean(ctx?.playing)
            const tableIsFull = Number.isFinite(maxPlayersLimit) && players.length >= maxPlayersLimit
            const settings = resolution?.effectiveSettings || resolveBlackjackSettings({ overrides: lobbyStateOverrides })
            const rawTimeoutMs = Number.isFinite(settings?.actionTimeoutMs)
                ? settings.actionTimeoutMs
                : Number.isFinite(ctx?.actionTimeoutMs)
                    ? ctx.actionTimeoutMs
                    : config.blackjack.actionTimeout.default
            const actionTimeoutSeconds = Math.max(1, Math.round(rawTimeoutMs / 1000))
            const hasPlayers = players.length > 0
            const meetsMinimumPlayers = players.length >= MIN_PLAYERS_TO_START
            const allowRebuyLabel = (() => {
                if (settings.allowRebuyMode === "off") return "Disabled"
                if (settings.allowRebuyMode === "once") return "Allow once"
                return `Enabled (${Math.round(settings.rebuyWindowMs / 1000)}s)`
            })()
            const autoCleanLabel = settings.autoCleanHands ? "On" : "Off"

            const playerCountLabel = Number.isFinite(maxPlayersLimit)
                ? `${players.length}/${maxPlayersLimit}`
                : `${players.length}`
            const playersFieldName = `👥 Players [${playerCountLabel}]`

            const thumbnail = new AttachmentBuilder('./assets/ui/Lobby.png')
            const embed = new EmbedBuilder()
                .setColor(palette.color)
                .setTitle("🃏 Blackjack — Lobby")
                .setDescription(`Press **Join** to buy in and take a seat. When everyone is ready, the host can press **Start**. Minimum players to start: **${MIN_PLAYERS_TO_START}**.`)
                .setImage('attachment://Lobby.png')
                .addFields(
                    {
                        name: playersFieldName,
                        value: formatPlayers(),
                        inline: true
                    },
                    {
                        name: "👑 Host",
                        value: hostMention,
                        inline: true
                    },
                    { name: '\u200b', value: '\u200b', inline: false },
                    {
                        name: "💰 Requirements",
                        value: `Min buy-in: ${setSeparator(ctx.minBuyIn)}$\nMax buy-in: ${setSeparator(ctx.maxBuyIn)}$\nMinimum bet: ${setSeparator(ctx.minBet)}$`,
                        inline: true
                    },
                    {
                        name: "🔍 Visibility",
                        value: state?.visibility === "public" ? "Public 🌐" : "Private 🔒",
                        inline: true
                    },
                    { name: '\u200b', value: '\u200b', inline: false },
                    {
                        name: "⏱️ Table speed",
                        value: `${actionTimeoutSeconds}s per action`,
                        inline: true
                    },
                    {
                        name: "📜 Table Rules",
                        value: `Rebuy: ${allowRebuyLabel}\nAuto clean: ${autoCleanLabel}`,
                        inline: true
                    }
                )
                .setFooter({ text: footerText })
                .setTimestamp()

            if (manager.isClosed) {
                return { embeds: [embed], components: [], files: [thumbnail] }
            }

            const components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("bj:join")
                        .setLabel("Join")
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(playing || tableIsFull),
                    new ButtonBuilder()
                        .setCustomId("bj:leave")
                        .setLabel("Leave")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(!hasPlayers || playing),
                    new ButtonBuilder()
                        .setCustomId("bj:start")
                        .setLabel("Start")
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(!meetsMinimumPlayers || playing),
                    new ButtonBuilder()
                        .setCustomId("bj:cancel")
                        .setLabel("Cancel")
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(playing),
                    new ButtonBuilder()
                        .setCustomId("bj:settings")
                        .setLabel("Settings")
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(playing)
                )
            ]

            if (state?.showSettings) {
                const rebuySelect = new StringSelectMenuBuilder()
                    .setCustomId("bj:settings:rebuyToggle")
                    .setPlaceholder(`♻️ Rebuy — ${allowRebuyLabel}`)
                    .addOptions(
                        { label: "Allow rebuy", value: "on", default: settings.allowRebuyMode === "on", emoji: "✅" },
                        { label: "Allow once", value: "once", default: settings.allowRebuyMode === "once", emoji: "1️⃣" },
                        { label: "Disable rebuy", value: "off", default: settings.allowRebuyMode === "off", emoji: "⛔" }
                    )

                const rebuyWindowSeconds = Math.max(1, Math.round(settings.rebuyWindowMs / 1000))
                const rebuyWindowOptions = [30, 60, 90, 120, 180]
                    .filter((sec) => {
                        const ms = sec * 1000
                        return ms >= blackjackSettingDefaults.minWindowMs && ms <= blackjackSettingDefaults.maxWindowMs
                    })
                if (!rebuyWindowOptions.includes(rebuyWindowSeconds)) {
                    rebuyWindowOptions.push(rebuyWindowSeconds)
                }
                const rebuyWindowSelect = new StringSelectMenuBuilder()
                    .setCustomId("bj:settings:rebuyWindow")
                    .setPlaceholder(`♻️ Rebuy window — ${rebuyWindowSeconds}s`)
                    .addOptions(
                        Array.from(new Set(rebuyWindowOptions))
                            .sort((a, b) => a - b)
                            .map((label) => ({
                                label: `♻️ Rebuy window — ${label}s`,
                                value: String(label),
                                default: rebuyWindowSeconds === label
                            }))
                    )

                const actionLimits = typeof ctx?.getActionTimeoutLimits === "function"
                    ? ctx.getActionTimeoutLimits()
                    : (config.blackjack.actionTimeout.allowedRange || {})
                const minActionSeconds = Number.isFinite(actionLimits?.min)
                    ? Math.ceil(actionLimits.min / 1000)
                    : 1
                const maxActionSeconds = Number.isFinite(actionLimits?.max)
                    ? Math.floor(actionLimits.max / 1000)
                    : actionTimeoutSeconds
                const actionTimeoutOptions = [15, 30, 45, 60, 75, 90, 120]
                    .filter((sec) => sec >= minActionSeconds && sec <= maxActionSeconds)
                if (!actionTimeoutOptions.includes(actionTimeoutSeconds)) {
                    actionTimeoutOptions.push(actionTimeoutSeconds)
                }
                const actionTimeoutSelect = new StringSelectMenuBuilder()
                    .setCustomId("bj:settings:actionTimeout")
                    .setPlaceholder(`⏱️ Table speed — ${actionTimeoutSeconds}s per action`)
                    .addOptions(
                        Array.from(new Set(actionTimeoutOptions))
                            .sort((a, b) => a - b)
                            .map((label) => ({
                                label: `⏱️ Table speed — ${label}s`,
                                value: String(label),
                                default: label === actionTimeoutSeconds
                            }))
                    )

                const cleanSelect = new StringSelectMenuBuilder()
                    .setCustomId("bj:settings:autoCleanHands")
                    .setPlaceholder(`🧹 Auto clean — ${settings.autoCleanHands ? "On" : "Off"}`)
                    .addOptions(
                        { label: "Auto clean - On", value: "on", default: settings.autoCleanHands === true, emoji: "✅" },
                        { label: "Auto clean - Off", value: "off", default: !settings.autoCleanHands, emoji: "⛔" }
                    )

                components.push(new ActionRowBuilder().addComponents(rebuySelect))
                components.push(new ActionRowBuilder().addComponents(rebuyWindowSelect))
                components.push(new ActionRowBuilder().addComponents(actionTimeoutSelect))
                components.push(new ActionRowBuilder().addComponents(cleanSelect))
            }

            return { embeds: [embed], components, files: [thumbnail] }
        }

        const ensureUserData = async(user) => {
            if (!user?.data) {
                const result = await client.SetData(user)
                if (result.error) {
                    if (result.error.type === "database") {
                        await channel.send({
                            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${user.tag}, database connection error. Please try again later.`)],
                            flags: MessageFlags.SuppressNotifications
                        }).catch(
                            logAndSuppress("Failed to send blackjack database error notice", {
                                scope: "commands.blackjack",
                                channelId: channel.id,
                                userId: user?.id
                            })
                        )
                    }
                    throw new Error("user-data-unavailable")
                }
                if (!result.data) {
                    throw new Error("user-data-missing")
                }
            }
        }

        const normalizeBuyIn = (user, requestedAmount) => {
            return bankrollManager.normalizeBuyIn({
                requested: requestedAmount,
                minBuyIn: game.minBuyIn,
                maxBuyIn: game.maxBuyIn,
                bankroll: bankrollManager.getBankroll(user)
            })
        }

        const sendLobbyMessage = async (payload) => {
            return await channel.send(payload)
        }

        const lobbySession = createLobbySession({
            send: sendLobbyMessage,
            logger,
            collectorOptions: { time: 5 * 60 * 1000 },
            render: renderLobbyView
        })
        game.lobbySession = lobbySession

        settingsResolution = settingsResolution || mergeSettings(lobbyOverrides)
        lobbySession.updateState({
            status: "waiting",
            footerText: statusConfig.waiting.footer,
            settings: lobbyOverrides,
            showSettings: false,
            visibility: lobbyVisibility,
            lobbyId
        })
        registerActiveSession(lobbyId, lobbySession)
        await lobbySession.open()
        if (isPublicLobby) {
            const currentPlayersCount = Math.max(1, game?.players?.length || 0)
            await registerPublicLobby(pool, {
                id: lobbyId,
                game: "blackjack",
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                messageId: lobbySession?.message?.id || null,
                hostId,
                hostName: interaction.user.tag,
                minBet: safeMinBet,
                maxPlayers: normalizedMaxPlayers,
                currentPlayers: currentPlayersCount,
                ttl: DEFAULT_PUBLIC_LOBBY_TTL_MS / 1000
            }).catch(() => null)
            await cleanupExpiredLobbies(pool).catch(() => null)
        }
        channel.collector = lobbySession.collector

        const refreshLobbyView = () => lobbySession.scheduleRefresh()

        const syncPublicPlayerCount = async() => {
            if (!isPublicLobby) return
            await updateLobbyPlayerCount(pool, lobbyId, resolveGameContext()?.players?.length || 0).catch(() => null)
        }

        const unregisterPublicLobbyIfNeeded = async() => {
            if (!isPublicLobby) return
            await unregisterPublicLobby(pool, lobbyId).catch(() => null)
        }

        const queueAutoStart = () => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) return
            if (ctx.players.length < MIN_PLAYERS_TO_START) {
                lobbySession.clearAutoTrigger()
                return
            }
            lobbySession.clearAutoTrigger()
            lobbySession.startAutoTrigger(AUTO_START_DELAY_MS, async() => {
                const liveCtx = resolveGameContext()
                if (!liveCtx || lobbySession.isClosed) return
                if (!liveCtx.players.length) {
                    lobbySession.updateState({
                        status: "canceled",
                        footerText: "Game canceled — no players joined in time."
                    })
                    await lobbySession.close({ status: "canceled", reason: "timeout" })
                    await game.Stop({ reason: "allPlayersLeft", notify: false }).catch(
                        buildStopLogHandler(channel.id, "auto-start timeout")
                    )
                    return
                }
                if (liveCtx.players.length < MIN_PLAYERS_TO_START) {
                    queueAutoStart()
                    return
                }
                await startGame({ initiatedBy: "timer" })
            })
        }

        const startGame = async({ initiatedBy } = {}) => {
            if (lobbySession.isClosed) return
            lobbySession.clearAutoTrigger()
            const footer = initiatedBy
                ? initiatedBy === "timer"
                    ? "Starting the game automatically."
                    : `Game starting — triggered by ${initiatedBy}`
                : statusConfig.starting.footer
            lobbySession.updateState({ status: "starting", footerText: footer })
            await unregisterPublicLobbyIfNeeded()
            const resolution = mergeSettings(lobbySession.state?.settings || lobbyOverrides)
            const effectiveSettings = resolution?.effectiveSettings || resolveBlackjackSettings({
                overrides: lobbySession.state?.settings || lobbyOverrides
            })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(effectiveSettings)
            }
            if (game && typeof game.inheritLobbyMirrors === "function") {
                game.inheritLobbyMirrors(lobbySession)
            }
            await lobbySession.close({ status: "starting", reason: "started" })
            try {
                await game.Run()
            } catch (error) {
                logger.error("Failed to start blackjack game", {
                    scope: "commands",
                    command: "blackjack",
                    channelId: channel.id,
                    error: error.message,
                    stack: error.stack
                })
                await game.Stop({ reason: "error", notify: false }).catch(
                    buildStopLogHandler(channel.id, "run-error")
                )
            }
        }

        lobbySession.bindGame(game, {
            onStop: async(options = {}) => {
                const reason = options?.reason
                const status = reason === "canceled" || reason === "error" ? "canceled" : "ended"
                const footerText = status === "canceled"
                    ? statusConfig.canceled.footer
                    : statusConfig.ended.footer
                lobbySession.updateState({ status, footerText })
                await unregisterPublicLobbyIfNeeded()
                await lobbySession.refresh({ force: true })
            }
        })

        lobbySession.registerComponentHandler("bj:join", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to notify user about unavailable table")
                )
                return
            }

            if (ctx.__stopping) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is closing. Please wait for the next lobby.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about stopping table")
                )
                return
            }

            try {
                await ensureUserData(interactionComponent.user)
            } catch (error) {
                if (error.message === "user-data-unavailable") return
                const responder = interactionComponent.deferred || interactionComponent.replied
                    ? interactionComponent.followUp.bind(interactionComponent)
                    : interactionComponent.reply.bind(interactionComponent)
                await responder({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ We could not load your profile right now. Please try again later.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to reply after user data error")
                )
                return
            }

            const maxSeats = Number.isFinite(ctx.maxPlayers) && ctx.maxPlayers > 0
                ? ctx.maxPlayers
                : Infinity
            if (ctx.players.length >= maxSeats) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is already full.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about full table")
                )
                return
            }

            if (ctx.GetPlayer(interactionComponent.user.id)) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are already seated at this table.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about duplicate seating")
                )
                return
            }

            const baseMessageId = lobbySession.message?.id || interactionComponent.message?.id || `msg:${Date.now()}`
            const modalCustomId = `bj:modal:${baseMessageId}:${interactionComponent.user.id}`
            const modal = new ModalBuilder()
                .setCustomId(modalCustomId)
                .setTitle("Join the table")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("buyin")
                            .setLabel("Buy-in amount")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                            .setPlaceholder(`Min: ${setSeparator(ctx.minBuyIn)}$ | Max: ${setSeparator(ctx.maxBuyIn)}$`)
                    )
                )

            let submission
            try {
                submission = await lobbySession.presentModal(interactionComponent, modal, {
                    time: 60_000,
                    filter: (i) => i.customId === modalCustomId && i.user.id === interactionComponent.user.id
                })
            } catch (modalError) {
                logger.error("Join modal submit error", {
                    scope: "commands",
                    command: "blackjack",
                    channelId: channel.id,
                    error: modalError.message
                })
                return
            }

            if (!submission) {
                return
            }

            if (ctx.__stopping) {
                await submission.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table has just been closed. Please join the next lobby.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to notify about stopping table post-modal", {
                        phase: "lobby"
                    })
                )
                return
            }

            const rawBuyIn = submission.fields.getTextInputValue("buyin")?.trim()
            const parsedBuyIn = rawBuyIn ? features.inputConverter(rawBuyIn) : ctx.minBuyIn
            if (!Number.isFinite(parsedBuyIn) || parsedBuyIn <= 0) {
                await submission.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Please enter a valid buy-in amount.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to warn about invalid buy-in", {
                        phase: "lobby"
                    })
                )
                return
            }

            const buyInResult = normalizeBuyIn(submission.user, parsedBuyIn)
            if (!buyInResult.ok) {
                const messages = {
                    invalidAmount: "The amount you entered is not within the allowed range.",
                    outOfRange: "The amount you entered is not within the allowed range.",
                    insufficientBankroll: "You do not have enough funds for that buy-in."
                }
                await submission.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${messages[buyInResult.reason] || "Unable to process your buy-in."}`)],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to warn about invalid buy-in range", {
                        phase: "lobby",
                        reason: buyInResult.reason
                    })
                )
                return
            }

            const addResult = await ctx.AddPlayer(submission.user, { buyIn: buyInResult.amount })
            if (!addResult?.ok) {
                await submission.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(addResult?.reason === "stopping"
                        ? "❌ The table was closed before we could seat you. No chips were taken."
                        : "❌ Unable to seat you right now. Please try again.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to reply about rejected blackjack join", {
                        phase: "lobby",
                        reason: addResult?.reason || "unknown"
                    })
                )
                return
            }
            await syncPublicPlayerCount()
            queueAutoStart()

            // Acknowledge submission silently
            await submission.deferUpdate().catch(
                buildCommandInteractionLog(submission, "Failed to defer lobby submission", {
                    phase: "lobby"
                })
            )

            refreshLobbyView()
        })

        lobbySession.registerComponentHandler("bj:leave", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (leave)")
                )
                return
            }

            await interactionComponent.deferUpdate().catch(
                logLobbyInteraction(interactionComponent, "Failed to defer leave interaction")
            )
            const player = ctx.GetPlayer(interactionComponent.user.id)
            if (!player) {
                await interactionComponent.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are not seated at this table.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn non-seated user on leave")
                )
                return
            }

            await ctx.RemovePlayer(interactionComponent.user)
            if (!ctx.players.length) {
                lobbySession.clearAutoTrigger()
            }
            await syncPublicPlayerCount()
            queueAutoStart()
            refreshLobbyView()

            await interactionComponent.followUp({
                embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription("✅ You left the table.")],
                flags: MessageFlags.Ephemeral
            }).catch(
                logLobbyInteraction(interactionComponent, "Failed to confirm table leave")
            )
        })

        lobbySession.registerComponentHandler("bj:start", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (start)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can start the game.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn non-host attempting to start")
                )
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(
                            logLobbyInteraction(interactionComponent, "Failed to delete non-host start warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            if (ctx.players.length < MIN_PLAYERS_TO_START) {
                const reply = await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription(`⚠️ You need at least ${MIN_PLAYERS_TO_START} players before starting.`)],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about missing players on start")
                )
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(
                            logLobbyInteraction(interactionComponent, "Failed to delete missing players warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            await interactionComponent.deferUpdate().catch(
                logLobbyInteraction(interactionComponent, "Failed to defer start interaction")
            )
            try {
                if (lobbySession.collector && !lobbySession.collector.ended) {
                    lobbySession.collector.stop("started")
                }
            } catch (_) {
                // ignore collector stop errors
            }
            await startGame({ initiatedBy: interactionComponent.user.tag })
        })

        lobbySession.registerComponentHandler("bj:cancel", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (cancel)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can cancel the game.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn non-host attempting to cancel")
                )
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(
                            logLobbyInteraction(interactionComponent, "Failed to delete non-host cancel warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            await interactionComponent.deferUpdate().catch(
                logLobbyInteraction(interactionComponent, "Failed to defer cancel interaction")
            )
            lobbySession.clearAutoTrigger()
            lobbySession.updateState({ status: "canceled", footerText: statusConfig.canceled.footer })
            await lobbySession.close({ status: "canceled", reason: "canceled" })
            await game.Stop({ reason: "canceled", notify: false }).catch(
                buildStopLogHandler(channel.id, "cancel")
            )
            await unregisterPublicLobbyIfNeeded()
        })

        lobbySession.on("end", async({ reason }) => {
            if (reason === "started") return
            if (lobbySession.isClosed) return
            lobbySession.clearAutoTrigger()
            const footer = reason === "time"
                ? "Lobby closed due to inactivity."
                : statusConfig.canceled.footer
            lobbySession.updateState({ status: "canceled", footerText: footer })
            await game.Stop({ reason: "canceled", notify: false }).catch(
                buildStopLogHandler(channel.id, reason || "lobby-end")
            )
            await unregisterPublicLobbyIfNeeded()
        })

        lobbySession.on("error", (collectorError) => {
            logger.error("Component collector error", {
                scope: "commands",
                command: "blackjack",
                channelId: channel.id,
                error: collectorError.message
            })
        })

        lobbySession.registerComponentHandler("bj:settings", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (settings)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn non-host attempting to edit settings")
                )
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(
                            logLobbyInteraction(interactionComponent, "Failed to delete non-host settings warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            await interactionComponent.deferUpdate().catch(
                logLobbyInteraction(interactionComponent, "Failed to defer settings toggle")
            )
            const showSettings = Boolean(lobbySession.state?.showSettings)
            lobbySession.updateState({ showSettings: !showSettings })
            lobbySession.scheduleRefresh()
        })

        lobbySession.registerPrefixedHandler("bj:settings:rebuyToggle", async(i) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn about unavailable table (rebuyToggle)")
                )
                return
            }
            if (i.user.id !== hostId) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn non-host attempting to edit rebuy")
                )
                return
            }
            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const updatedOverrides = {
                ...currentOverrides,
                allowRebuyMode: value === "off" ? "off" : value === "once" ? "once" : "on"
            }
            lobbyOverrides = updatedOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(
                logLobbyInteraction(i, "Failed to defer rebuy toggle update")
            )
        })

        lobbySession.registerPrefixedHandler("bj:settings:rebuyWindow", async(i) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn about unavailable table (rebuyWindow)")
                )
                return
            }
            if (i.user.id !== hostId) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn non-host attempting to edit rebuy window")
                )
                return
            }
            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const seconds = Number(value)
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const updatedOverrides = {
                ...currentOverrides,
                rebuyWindowMs: seconds * 1000
            }
            lobbyOverrides = updatedOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(
                logLobbyInteraction(i, "Failed to defer rebuy window update")
            )
        })

        lobbySession.registerPrefixedHandler("bj:settings:autoCleanHands", async(i) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn about unavailable table (autoClean)")
                )
                return
            }
            if (i.user.id !== hostId) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn non-host attempting to edit auto-clean")
                )
                return
            }
            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const autoCleanEnabled = value === "on"
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const updatedOverrides = {
                ...currentOverrides,
                autoCleanHands: autoCleanEnabled
            }
            lobbyOverrides = updatedOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(
                logLobbyInteraction(i, "Failed to defer auto-clean update")
            )
        })

        lobbySession.registerPrefixedHandler("bj:settings:actionTimeout", async(i) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn about unavailable table (actionTimeout)")
                )
                return
            }
            if (i.user.id !== hostId) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn non-host attempting to edit action timeout")
                )
                return
            }

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const parsedSeconds = Number(value)
            if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0 || typeof ctx.updateActionTimeoutFromSeconds !== "function") {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Invalid table speed value.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to warn about invalid action timeout selection")
                )
                return
            }

            const updateResult = ctx.updateActionTimeoutFromSeconds(parsedSeconds)
            if (!updateResult?.ok) {
                await i.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to update the table speed.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to reply after action timeout update error")
                )
                return
            }

            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            lobbyOverrides = { ...currentOverrides, actionTimeoutMs: updateResult.value }
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }

            const seconds = Math.max(1, Math.round(updateResult.value / 1000))
            const limits = typeof ctx.getActionTimeoutLimits === "function"
                ? ctx.getActionTimeoutLimits()
                : (config.blackjack.actionTimeout.allowedRange || {})
            const minSeconds = Number.isFinite(limits?.min) ? Math.round(limits.min / 1000) : null
            const maxSeconds = Number.isFinite(limits?.max) ? Math.round(limits.max / 1000) : null
            const hasRange = Number.isFinite(minSeconds) && Number.isFinite(maxSeconds)
            const note = updateResult.clamped && hasRange
                ? ` (allowed range ${minSeconds}-${maxSeconds}s)`
                : ""

            await i.reply({
                embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`⏱️ Table speed updated to **${seconds}s**${note}.`)],
                flags: MessageFlags.Ephemeral
            }).catch(
                logLobbyInteraction(i, "Failed to confirm action timeout update")
            )
            lobbySession.scheduleRefresh()
        })

    } catch (error) {
        logger.error("Blackjack command failed", { scope: "commands", command: "blackjack", error })
        if (game) await game.Stop({ reason: "error" }).catch(buildBlackjackStopLogger(channel?.id, "command-error"))
        await interaction.followUp({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ An error occurred while starting the game. Please try again later.")], flags: MessageFlags.Ephemeral })
    } finally {
        if (channel && channel.collector) {
            channel.collector = null
        }
        if (channel.__blackjackStarting) {
            channel.__blackjackStarting = false
        }
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Start a blackjack game in the current channel.")

module.exports = createCommand({
    name: "blackjack",
    description: "Start a blackjack game in the current channel.",
    slashCommand,
    deferEphemeral: false,
    execute: runBlackjack
})

//play <minBet> [maxPlayers]