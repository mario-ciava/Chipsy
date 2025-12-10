const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, AttachmentBuilder } = require("discord.js")
const { randomUUID } = require("node:crypto")
const TexasGame = require("../games/texas/texasGame.js")
const features = require("../../shared/features")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession, registerActiveSession, getActiveSession, registerPublicLobby, unregisterPublicLobby, updateLobbyPlayerCount, cleanupExpiredLobbies, findPublicLobbies, countUserPublicLobbies } = require("../lobbies")
const { resolveTexasSettings, defaults: texasSettingDefaults } = require("../games/texas/settings")
const config = require("../../config")

const EPHEMERAL_CLEANUP_MS = 8000
const TEXAS_DEFAULT_MAX_PLAYERS = config.texas?.maxPlayers?.default ?? 9
const TEXAS_DEFAULT_MIN_BET = config.texas?.minBet?.default ?? 100
const DEFAULT_PUBLIC_LOBBY_TTL_MS = 30 * 60 * 1000
const MAX_PUBLIC_LOBBIES_PER_USER = 1

const buildTexasCommandLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "commands.texas",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const buildTexasStopLogger = (channelId, reason) => (error) => {
    logger.warn("Failed to stop Texas game", {
        scope: "commands.texas",
        channelId,
        reason,
        error: error?.message
    })
    return null
}

const runTexas = async(interaction, client) => {
    const channel = interaction.channel
    const pool = client?.connection

    const replyOrEdit = (payload = {}) => {
        const finalPayload = { ...payload, allowedMentions: { parse: [] } }
        return sendInteractionResponse(interaction, finalPayload)
    }

    const scheduleEphemeralCleanup = (message) => {
        if (message && typeof message.delete === "function") {
            setTimeout(() => {
                message.delete().catch(() => null)
            }, EPHEMERAL_CLEANUP_MS)
        }
    }

    const logLobbyInteraction = (component, message, extra = {}) =>
        buildTexasCommandLog(component, message, { phase: "lobby", ...extra })

    if (channel.__texasStarting) {
        await replyOrEdit({
            embeds: [new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${interaction.user.tag}, please wait: a Texas Hold'em table is already being initialized.`,
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
                    text: `${interaction.user.tag}, access denied: a game is already in progress in this channel.`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    channel.__texasStarting = true

    let game = null
    let lobbyOverrides = {}
    let settingsLayers = {
        defaults: resolveTexasSettings(),
        guild: {},
        channel: {}
    }
    let settingsResolution = null

    const mergeSettings = (overrides = lobbyOverrides) => {
        if (typeof client?.mergeGameSettingsLayers === "function") {
            settingsResolution = client.mergeGameSettingsLayers({
                game: "texas",
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
            const effectiveSettings = resolveTexasSettings({ overrides: mergedOverrides })
            if (persistentDisabled) {
                effectiveSettings.enabled = false
            }
            settingsResolution = {
                game: "texas",
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
            .setTitle("♠️ Texas Hold'em | Lobby Setup")
            .setDescription("What would you like to do? Please choose an option below to get started.")
            .setThumbnail('attachment://Lobby.png')

        const components = [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("tx:init:create")
                    .setLabel("Create New Lobby")
                    .setEmoji("🆕")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("tx:init:browse")
                    .setLabel("Search Open Lobbies")
                    .setEmoji("🔍")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId("tx:init:exit")
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
                filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("tx:init:"),
                time: config.lobby.collectorTimeout.default
            })

            collector.on('collect', async (selection) => {
                if (isResolved) return

                if (selection.customId === "tx:init:browse") {
                    await selection.deferUpdate()
                    let lobbies = []
                    try {
                        lobbies = await findPublicLobbies({ pool: client.connection, game: 'texas', limit: 25 })
                    } catch (err) {
                        logger.error("Failed to fetch public lobbies", { scope: "texas", error: err.message })
                    }

                    if (lobbies.length === 0) {
                        await interaction.followUp({
                            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ No public lobbies found. Create one!")],
                            flags: MessageFlags.Ephemeral
                        })
                        return
                    }

                    const select = new StringSelectMenuBuilder()
                       .setCustomId("tx:init:select")
                       .setPlaceholder("Select a lobby to join...")
                       .addOptions(lobbies.map(l => ({
                           label: `Min $${setSeparator(l.min_bet)} • ${l.current_players}/${l.max_players} players`,
                           description: `Host: ${l.host_name || 'Unknown'}`,
                           value: l.id
                       })))

                    await interaction.editReply({
                        content: null,
                        embeds: [new EmbedBuilder().setColor(Colors.Blue).setTitle("🔍 Open Texas Hold'em Lobbies")],
                        components: [new ActionRowBuilder().addComponents(select)]
                    })
                }
                else if (selection.customId === "tx:init:select") {
                    await selection.deferUpdate()
                    isResolved = true
                    collector.stop()
                    resolve({ intent: "join", lobbyId: selection.values[0] })
                }
                else if (selection.customId === "tx:init:exit") {
                    await selection.deferUpdate()
                    isResolved = true
                    collector.stop()
                    await interaction.deleteReply().catch(() => null)
                    resolve(null)
                }
                else if (selection.customId === "tx:init:create") {
                    const modalCustomId = `tx:create:${selection.id}`
                    const modal = new ModalBuilder()
                        .setCustomId(modalCustomId)
                        .setTitle("Create Texas Hold'em Lobby")
                        .addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId("minBet")
                                    .setLabel("Minimum Bet")
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                                    .setValue(String(TEXAS_DEFAULT_MIN_BET))
                            ),
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId("maxPlayers")
                                    .setLabel("Max Players (2-9)")
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(false)
                                    .setPlaceholder(String(TEXAS_DEFAULT_MAX_PLAYERS))
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
                        logger.warn("Failed to show Texas lobby creation modal", {
                            scope: "commands.texas",
                            error: error?.message
                        })
                        return
                    }

                    try {
                        const submission = await selection.awaitModalSubmit({
                            time: config.lobby.modalTimeout.default,
                            filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id
                        })
                        
                        const minBetRaw = submission.fields.getTextInputValue("minBet")?.trim() || String(TEXAS_DEFAULT_MIN_BET)
                        const maxPlayersRaw = submission.fields.getTextInputValue("maxPlayers")?.trim()
                        const maxPlayersInput = maxPlayersRaw ? Number.parseInt(maxPlayersRaw, 10) : null
                        const visibility = sanitizeVisibility(submission.fields.getTextInputValue("visibility") || "private")

                        await submission.deferUpdate().catch(() => null)
                        
                        isResolved = true
                        collector.stop()
                        resolve({ intent: "create", minBetRaw, maxPlayersInput, visibility })
                    } catch (error) {
                        // If modal times out or is cancelled, we do nothing.
                        // The collector remains active, so the user can click the button again.
                    }
                }
            })

            collector.on('end', (_, reason) => {
                if (!isResolved) {
                    if (reason === 'time') {
                        replyOrEdit({
                            embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⌛ Lobby setup expired. Please run `/texas` again.")],
                            flags: MessageFlags.Ephemeral,
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
            if (channel.__texasStarting) channel.__texasStarting = false
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
                channel.__texasStarting = false
                return
            }

            const mirrorMessage = await activeSession.addMirror(channel)
            if (!mirrorMessage) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Failed to join lobby view. Check bot permissions.")],
                    flags: MessageFlags.Ephemeral
                })
            }
            channel.__texasStarting = false
            return
        }

        const minBetRaw = lobbyInput.minBetRaw
        const maxPlayersInput = lobbyInput.maxPlayersInput
        const lobbyVisibility = sanitizeVisibility(lobbyInput.visibility)
        const isPublicLobby = lobbyVisibility === "public"

        if (isPublicLobby) {
            const currentCount = await countUserPublicLobbies(pool, interaction.user.id)
            if (currentCount >= MAX_PUBLIC_LOBBIES_PER_USER) {
                await interaction.followUp({
                    embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ You already have ${currentCount} active public lobby. Please close it before creating a new one.`)],
                    flags: MessageFlags.Ephemeral
                })
                channel.__texasStarting = false
                return
            }
        }

        const minBet = features.inputConverter(minBetRaw)

        if (!Number.isFinite(minBet) || minBet <= 0) {
            await interaction.followUp({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${interaction.user.tag}, the minimum bet must be a positive number.`)],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const minPlayersAllowed = config.texas?.minPlayers?.default ?? 2
        const maxPlayersAllowed = config.texas?.maxPlayers?.default ?? TEXAS_DEFAULT_MAX_PLAYERS
        const normalizedMaxPlayers = Number.isInteger(maxPlayersInput)
            ? Math.min(Math.max(maxPlayersInput, minPlayersAllowed), maxPlayersAllowed)
            : maxPlayersAllowed

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating Texas Hold'em game", {
            scope: "commands",
            command: "texas",
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            channelId: channel.id
        })

        if (typeof client?.resolveGameSettings === "function") {
            try {
                const resolved = await client.resolveGameSettings({
                    game: "texas",
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
                logger.warn("Failed to resolve persisted Texas settings", {
                    scope: "commands.texas",
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
                .setTitle("♠️ Texas Hold'em Disabled")
                .setDescription(`Texas Hold'em is disabled in ${scopeText}.\nAsk an administrator to enable it via \`/config\`.`)
            await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral })
            return
        }

        const messageAdapter = {
            author: interaction.user,
            channel: interaction.channel,
            client
        }

        const effectiveSettings = settingsResolution?.effectiveSettings || resolveTexasSettings({ overrides: lobbyOverrides })

        game = new TexasGame({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            maxBuyIn,
            settings: effectiveSettings
        });
        registerGame(client, game)
        channel.game = game

        const hostId = interaction.user.id
        const hostMention = `<@${hostId}>`
        if (typeof game.setRemoteMeta === "function") {
            const hostAvatar = typeof interaction.user.displayAvatarURL === "function"
                ? interaction.user.displayAvatarURL({ extension: "png", size: 64 })
                : null
            game.setRemoteMeta({
                label: "Texas Hold'em",
                type: "texas",
                origin: "command:texas",
                host: {
                    id: hostId,
                    tag: interaction.user.tag,
                    username: interaction.user.username,
                    avatar: hostAvatar
                },
                channelId: channel.id,
                channelName: channel.name,
                guildId: channel.guild?.id,
                guildName: channel.guild?.name,
                turnTimeoutMs: game.actionTimeoutMs || null
            })
        }

        const lobbyId = game.remoteControl?.id || `texas-${(randomUUID ? randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)}`

        const resolveLobbyStack = (player) => {
            if (!player) return 0
            const entryStack = Number.isFinite(player.entryStack) ? player.entryStack : null
            if (entryStack !== null && entryStack >= 0) return entryStack
            const stack = Number.isFinite(player.stack) ? player.stack : 0
            return stack
        }

        const formatPlayers = () => {
            const players = game?.players || []
            if (!players.length) return "—"
            return players
                .map(p => {
                    const displayStack = resolveLobbyStack(p)
                    return `<@${p.id}> - ${setSeparator(displayStack)}$`
                })
                .join("\n")
        }

        const statusConfig = {
            waiting: { color: Colors.Green, footer: "Waiting for players..." },
            starting: { color: Colors.Blurple, footer: "Starting the game..." },
            canceled: { color: Colors.Red, footer: "Game canceled." },
            ended: { color: Colors.DarkGrey, footer: "Game ended." }
        }

        const renderLobbyView = ({ state }) => {
            const lobbyStateOverrides = state?.settings || lobbyOverrides
            const resolution = mergeSettings(lobbyStateOverrides)
            const players = game?.players || []
            const maxPlayersLimit = game?.maxPlayers || 9
            const status = state?.status || "waiting"
            const palette = statusConfig[status] || statusConfig.waiting
            const lobbyClosed = Boolean(state?.closed || status === "ended" || status === "canceled")
            const playerCountLabel = `${players.length}/${maxPlayersLimit}`
            const tableIsFull = players.length >= maxPlayersLimit
            const hasPlayers = players.length > 1
            const settings = resolution?.effectiveSettings || resolveTexasSettings({ overrides: lobbyStateOverrides })
            const actionTimeoutSeconds = Math.round((settings.actionTimeoutMs || game?.actionTimeoutMs || config.texas.actionTimeout.default) / 1000)
            const allowRebuyLabel = (() => {
                if (settings.allowRebuyMode === "off") return "Disabled"
                if (settings.allowRebuyMode === "once") return "Allow once"
                return `Enabled (${Math.round(settings.rebuyWindowMs / 1000)}s)`
            })()
            const autoCleanLabel = settings.autoCleanHands ? "On" : "Off"

            const thumbnail = new AttachmentBuilder('./assets/ui/Lobby.png')
            const embed = new EmbedBuilder()
                .setColor(palette.color)
                .setTitle("♠️ Texas Hold'em — Lobby")
                .setDescription("Press **Join** to buy in. The host can start when at least 2 players have joined.")
                .setImage('attachment://Lobby.png')
                .addFields(
                    { name: `👥 Players [${playerCountLabel}]`, value: formatPlayers(), inline: true },
                    { name: "👑 Host", value: hostMention, inline: true },
                    { name: "Visibility", value: state?.visibility === "public" ? "Public 🌐" : "Private 🔒", inline: true },
                    { name: "💰 Requirements", value: `Min buy-in: ${setSeparator(game.minBuyIn)}$\nMax buy-in: ${setSeparator(game.maxBuyIn)}$\nSmall/Big Blind: ${setSeparator(game.minBet / 2)}$/${setSeparator(game.minBet)}$`, inline: false },
                    { name: "⏱️ Table speed", value: `${actionTimeoutSeconds}s per action`, inline: true },
                    { name: "♻️ Rebuy", value: allowRebuyLabel, inline: true },
                    { name: "🧹 Auto clean hands", value: autoCleanLabel, inline: true }
                )
                .setFooter({ text: state?.footerText || palette.footer })
                .setTimestamp()

            const components = []
            if (!lobbyClosed) {
                components.push(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId("tx:join").setLabel("Join").setStyle(ButtonStyle.Success).setDisabled(tableIsFull),
                        new ButtonBuilder().setCustomId("tx:leave").setLabel("Leave").setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId("tx:start").setLabel("Start").setStyle(ButtonStyle.Primary).setDisabled(!hasPlayers),
                        new ButtonBuilder().setCustomId("tx:cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("tx:settings").setLabel("Settings").setStyle(ButtonStyle.Secondary)
                    )
                )

                if (state?.showSettings) {
                    const rebuySelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:rebuyToggle")
                        .setPlaceholder("Rebuy")
                        .addOptions(
                            { label: "Allow rebuy", value: "on", default: settings.allowRebuyMode === "on", emoji: "✅" },
                            { label: "Allow once", value: "once", default: settings.allowRebuyMode === "once", emoji: "1️⃣" },
                            { label: "Disallow rebuy", value: "off", default: settings.allowRebuyMode === "off", emoji: "⛔" }
                        )

                    const currentActionSeconds = Math.round((settings.actionTimeoutMs || game?.actionTimeoutMs || 0) / 1000)
                    const actionTimeoutSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:actionTimeout")
                        .setPlaceholder(`⏱️ Table speed — ${currentActionSeconds}s per action`)
                        .addOptions(
                            ["15","30","45","60","75","90","120","180","240"].map((label) => {
                                const numeric = Number(label)
                                return {
                                    label: `⏱️ Table speed — ${label}s`,
                                    value: label,
                                    default: currentActionSeconds === numeric
                                }
                            })
                        )

                    const rebuyWindowSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:rebuyWindow")
                        .setPlaceholder(`♻️ Rebuy window — ${Math.round(settings.rebuyWindowMs / 1000)}s`)
                        .addOptions(
                            ["30","60","90"].map((label) => ({
                                label: `♻️ Rebuy window — ${label}s`,
                                value: label,
                                default: Math.round(settings.rebuyWindowMs / 1000) === Number(label)
                            }))
                        )

                    const cleanSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:autoCleanHands")
                        .setPlaceholder(`🧹 Auto clean hands — ${settings.autoCleanHands ? "On" : "Off"}`)
                        .addOptions(
                            { label: "Auto clean - On", value: "on", default: settings.autoCleanHands === true, emoji: "✅" },
                            { label: "Auto clean - Off", value: "off", default: !settings.autoCleanHands, emoji: "⛔" }
                        )

                    components.push(new ActionRowBuilder().addComponents(rebuySelect))
                    components.push(new ActionRowBuilder().addComponents(actionTimeoutSelect))
                    components.push(new ActionRowBuilder().addComponents(rebuyWindowSelect))
                    components.push(new ActionRowBuilder().addComponents(cleanSelect))
                }
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
                            logAndSuppress("Failed to send Texas database error notice", {
                                scope: "commands.texas",
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
                game: "texas",
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

        const syncPublicPlayerCount = async() => {
            if (!isPublicLobby) return
            await updateLobbyPlayerCount(pool, lobbyId, game?.players?.length || 0).catch(() => null)
        }

        const unregisterPublicLobbyIfNeeded = async() => {
            if (!isPublicLobby) return
            await unregisterPublicLobby(pool, lobbyId).catch(() => null)
        }

        const startGame = async ({ initiatedBy } = {}) => {
            if (lobbySession.isClosed) return

            // Safety check: remove duplicate players before starting
            const seenIds = new Set()
            const uniquePlayers = []
            for (const player of game.players) {
                if (!seenIds.has(player.id)) {
                    seenIds.add(player.id)
                    uniquePlayers.push(player)
                } else {
                    logger.warn("Removed duplicate player before game start", {
                        scope: "texas.lobby",
                        playerId: player.id,
                        playerTag: player.tag
                    })
                }
            }
            game.players = uniquePlayers

            const footer = initiatedBy ? `Game starting — triggered by ${initiatedBy}` : "Starting..."
            lobbySession.updateState({ status: "starting", footerText: footer })
            await unregisterPublicLobbyIfNeeded()
            await lobbySession.close({ reason: "started" })
            try {
                const resolution = mergeSettings(lobbySession.state?.settings || lobbyOverrides)
                const effectiveSettings = resolution?.effectiveSettings || resolveTexasSettings({ overrides: lobbyOverrides })
                if (game && typeof game.applySettings === "function") {
                    game.applySettings(effectiveSettings)
                }
                if (game && typeof game.inheritLobbyMirrors === "function") {
                    game.inheritLobbyMirrors(lobbySession)
                }
                await game.Run()
            } catch (error) {
                logger.error("Failed to start Texas Hold'em game", { scope: "commands", command: "texas", error })
                await game.Stop({ reason: "error" }).catch((stopError) => {
                    logger.warn("Failed to stop Texas game after run error", {
                        scope: "commands.texas",
                        channelId: channel.id,
                        error: stopError?.message
                    })
                })
            }
        }

        lobbySession.bindGame(game, {
            onStop: async ({ reason }) => {
                const status = reason === "canceled" ? "canceled" : "ended"
                lobbySession.updateState({ status, footerText: statusConfig[status].footer })
                await unregisterPublicLobbyIfNeeded()
                await lobbySession.refresh({ force: true, components: [] })
            }
        })

        lobbySession.registerComponentHandler("tx:join", async (i) => {
            // Wrap entire handler to suppress errors from abandoned modals
            // When user opens multiple modals and confirms only one, the other handlers
            // will throw when they timeout - we should suppress those silently
            try {
                if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")], flags: MessageFlags.Ephemeral })

                try {
                    await ensureUserData(i.user)
                } catch (error) {
                    if (error.message === "user-data-unavailable") return
                    const responder = i.deferred || i.replied
                        ? i.followUp.bind(i)
                        : i.reply.bind(i)
                    await responder({
                        embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ We could not load your profile right now. Please try again later.")],
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        logLobbyInteraction(i, "Failed to respond after user data error")
                    )
                    return
                }
                if (game.players.length >= game.maxPlayers) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is full.")], flags: MessageFlags.Ephemeral })
                if (game.GetPlayer(i.user.id)) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are already at this table.")], flags: MessageFlags.Ephemeral })

                const modal = new ModalBuilder().setCustomId(`tx:modal:${i.id}`).setTitle("Join Table").addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId("buyin").setLabel("Buy-in Amount").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(game.minBuyIn))
                    )
                )

                const submission = await lobbySession.presentModal(i, modal)
                if (!submission) return

                // Re-check after modal to prevent race condition (user may have joined via another modal)
                if (game.GetPlayer(submission.user.id)) {
                    return submission.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are already at this table.")], flags: MessageFlags.Ephemeral })
                }

                const rawBuyIn = submission.fields.getTextInputValue("buyin")
                const parsedBuyIn = features.inputConverter(rawBuyIn)
                const buyInResult = bankrollManager.normalizeBuyIn({ requested: parsedBuyIn, minBuyIn: game.minBuyIn, maxBuyIn: game.maxBuyIn, bankroll: bankrollManager.getBankroll(submission.user) })

                if (!buyInResult.ok) {
                    return submission.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ ${buyInResult.reason}`)], flags: MessageFlags.Ephemeral })
                }

                const added = await game.AddPlayer(submission.user, { buyIn: buyInResult.amount })
                if (!added) {
                    await submission.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to join this table. Please try again.")], flags: MessageFlags.Ephemeral })
                    return
                }
                game.rememberPlayerInteraction(submission.user.id, submission)
                const joinMessage = await submission.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ You joined with **${setSeparator(buyInResult.amount)}$**.`)], 
                    flags: MessageFlags.Ephemeral
                })
                scheduleEphemeralCleanup(joinMessage)
                await syncPublicPlayerCount()
                lobbySession.scheduleRefresh()
            } catch (error) {
                // Suppress errors from abandoned modals - if user already joined via another modal,
                // or the lobby is closed, just silently exit
                if (game.GetPlayer(i.user.id) || lobbySession.isClosed) {
                    return
                }
                // Re-throw other errors so they get logged properly
                throw error
            }
        })

        lobbySession.registerComponentHandler("tx:leave", async (i) => {
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This table is no longer available.")], flags: MessageFlags.Ephemeral })
            if (!game.GetPlayer(i.user.id)) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are not at this table.")], flags: MessageFlags.Ephemeral })
            
            const removed = await game.RemovePlayer(i.user)
            if (removed) {
                await i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription("✅ You have left the table.")], flags: MessageFlags.Ephemeral })
                await syncPublicPlayerCount()
                lobbySession.scheduleRefresh()
            } else {
                await i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Failed to leave the table. Please try again.")], flags: MessageFlags.Ephemeral })
            }
        })

        lobbySession.registerComponentHandler("tx:start", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can start the game.")], flags: MessageFlags.Ephemeral })
            if (game.players.length < game.getMinimumPlayers()) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription(`⚠️ You need at least ${game.getMinimumPlayers()} players to start.`)], flags: MessageFlags.Ephemeral })
            
            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            startGame({ initiatedBy: i.user.tag })
        })

        lobbySession.registerComponentHandler("tx:settings", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")], flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is no longer available.")], flags: MessageFlags.Ephemeral })

            const showSettings = Boolean(lobbySession.state?.showSettings)
            lobbySession.updateState({ showSettings: !showSettings })
            await i.deferUpdate().catch(() => null)
            lobbySession.scheduleRefresh()
        })

        // Handle rebuy toggle via select menu
        lobbySession.registerPrefixedHandler("tx:settings:rebuyToggle", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")], flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is no longer available.")], flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const currentRebuyWindowMs = Number.isFinite(currentOverrides.rebuyWindowMs)
                ? currentOverrides.rebuyWindowMs
                : settingsResolution?.effectiveSettings?.rebuyWindowMs ?? texasSettingDefaults.rebuyWindowMs ?? 60000
            const updatedOverrides = {
                ...currentOverrides,
                allowRebuyMode: value === "off" ? "off" : value === "once" ? "once" : "on",
                rebuyWindowMs: currentRebuyWindowMs
            }
            lobbyOverrides = updatedOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:actionTimeout", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")], flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is no longer available.")], flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const seconds = Number(value)
            const updateResult = game.updateActionTimeoutFromSeconds(seconds)
            if (!updateResult.ok) {
                await i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Invalid action timeout.")], flags: MessageFlags.Ephemeral }).catch(() => null)
                return
            }
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            lobbyOverrides = { ...currentOverrides, actionTimeoutMs: updateResult.value }
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:rebuyWindow", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")], flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is no longer available.")], flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const seconds = Number(value)

            const baseOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const newOverrides = {
                ...baseOverrides,
                allowRebuyMode: baseOverrides.allowRebuyMode ?? settingsResolution?.effectiveSettings?.allowRebuyMode ?? "on",
                rebuyWindowMs: seconds * 1000
            }

            lobbyOverrides = newOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:autoCleanHands", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can change settings.")], flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ This table is no longer available.")], flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const autoCleanEnabled = value === "on"
            const currentOverrides = lobbySession.state?.settings || lobbyOverrides || {}
            const newOverrides = {
                ...currentOverrides,
                allowRebuyMode: currentOverrides.allowRebuyMode ?? settingsResolution?.effectiveSettings?.allowRebuyMode ?? "on",
                rebuyWindowMs: currentOverrides.rebuyWindowMs ?? settingsResolution?.effectiveSettings?.rebuyWindowMs ?? texasSettingDefaults.rebuyWindowMs ?? 60 * 1000,
                autoCleanHands: autoCleanEnabled
            }

            lobbyOverrides = newOverrides
            settingsResolution = mergeSettings(lobbyOverrides)
            lobbySession.updateState({ settings: lobbyOverrides })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(settingsResolution.effectiveSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerComponentHandler("tx:cancel", async (i) => {
            if (i.user.id !== hostId) return i.reply({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Only the host can cancel the game.")], flags: MessageFlags.Ephemeral })

            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            await game.Stop({ reason: "canceled" })
            await unregisterPublicLobbyIfNeeded()
        })

        lobbySession.on("end", async ({ reason }) => {
            if (reason !== "started") {
                await game.Stop({ reason: "canceled" }).catch(
                    buildTexasStopLogger(channel.id, reason || "lobby-end")
                )
            }
            await unregisterPublicLobbyIfNeeded()
        })

    } catch (error) {
        logger.error("Texas command failed", { scope: "commands", command: "texas", error })
        if (game) await game.Stop({ reason: "error" }).catch(buildTexasStopLogger(channel?.id, "command-error"))
        await interaction.followUp({ embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ An error occurred. Please try again.")], flags: MessageFlags.Ephemeral })
    } finally {
        if (channel) {
            channel.collector = null
            channel.__texasStarting = false
        }
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("texas")
    .setDescription("Start a Texas Hold'em game.")

module.exports = createCommand({
    name: "texas",
    description: "Start a Texas Hold'em game.",
    slashCommand,
    deferEphemeral: false,
    execute: runTexas
})