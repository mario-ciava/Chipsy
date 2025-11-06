const { SlashCommandBuilder, EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, MessageFlags, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const BlackJack = require("../games/blackjackGame.js")
const features = require("../../shared/features")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession } = require("../lobbies")
const config = require("../../config")

const AUTO_START_DELAY_MS = config.lobby.autoStartDelay.default
const MIN_PLAYERS_TO_START = Math.max(1, Number(config.blackjack.minPlayers?.default) || 1)

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

    try {
        // Use Discord.js native option getters - clean and type-safe!
        const minBetRaw = interaction.options.getString("minbet", true) // Required
        const maxPlayersInput = interaction.options.getInteger("maxplayers") // Optional, already number!

        // Convert minBet (supports "1k", "1m" etc)
        const minBet = features.inputConverter(minBetRaw)

        // Validation
        if (!Number.isFinite(minBet) || minBet <= 0) {
            await replyOrEdit({
                content: `❌ ${interaction.user.tag}, minimum bet must be a positive number.`,
                flags: MessageFlags.Ephemeral
            })
            return
        }

        // maxPlayers is already validated by Discord (min: 1, max: 7); when omitted use configured default
        const normalizedMaxPlayers = Number.isInteger(maxPlayersInput)
            ? Math.min(Math.max(maxPlayersInput, 1), 7)
            : config.blackjack.maxPlayersDefault.default

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating BlackJack game", {
            scope: "commands",
            command: "blackjack",
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            channelId: channel.id
        })

        // Create message adapter for game (game code expects this format)
        const messageAdapter = {
            author: interaction.user,
            channel: interaction.channel,
            client
        }

        channel.game = new BlackJack({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            maxBuyIn
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
            const ctx = resolveGameContext()
            const players = ctx?.players || []
            const maxPlayersLimit = Number.isFinite(ctx?.maxPlayers) && ctx.maxPlayers > 0
                ? ctx.maxPlayers
                : null
            const palette = statusConfig[state.status] || statusConfig.waiting
            const footerText = state.footerText || palette.footer
            const playing = Boolean(ctx?.playing)
            const tableIsFull = Number.isFinite(maxPlayersLimit) && players.length >= maxPlayersLimit
            const rawTimeoutMs = Number.isFinite(ctx?.actionTimeoutMs)
                ? ctx.actionTimeoutMs
                : config.blackjack.actionTimeout.default
            const actionTimeoutSeconds = Math.max(1, Math.round(rawTimeoutMs / 1000))
            const hasPlayers = players.length > 0
            const meetsMinimumPlayers = players.length >= MIN_PLAYERS_TO_START

            const playerCountLabel = Number.isFinite(maxPlayersLimit)
                ? `${players.length}/${maxPlayersLimit}`
                : `${players.length}`
            const playersFieldName = `👥 Players [${playerCountLabel}]`

            const embed = new EmbedBuilder()
                .setColor(palette.color)
                .setTitle("🃏 Blackjack — Lobby")
                .setDescription(`Press **Join** to buy in and take a seat. When everyone is ready, the host can press **Start**. Minimum players to start: **${MIN_PLAYERS_TO_START}**.`)
                .addFields(
                    {
                        name: playersFieldName,
                        value: formatPlayers(),
                        inline: false
                    },
                    {
                        name: "💰 Requirements",
                        value: `Min buy-in: ${setSeparator(ctx.minBuyIn)}$\nMax buy-in: ${setSeparator(ctx.maxBuyIn)}$\nMinimum bet: ${setSeparator(ctx.minBet)}$`,
                        inline: false
                    },
                    {
                        name: "👑 Host",
                        value: hostMention,
                        inline: true
                    },
                    {
                        name: "⏱️ Table speed",
                        value: `${actionTimeoutSeconds}s per action`,
                        inline: true
                    }
                )
                .setFooter({ text: footerText })
                .setTimestamp()

            if (manager.isClosed) {
                return { embeds: [embed], components: [] }
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

            return { embeds: [embed], components }
        }

        const ensureUserData = async(user) => {
            if (!user?.data) {
                const result = await client.SetData(user)
                if (result.error) {
                    if (result.error.type === "database") {
                        await channel.send({
                            content: `❌ ${user.tag}, database connection error. Please try again later.`,
                            allowedMentions: { parse: [] },
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

        const lobbySession = createLobbySession({
            send: replyOrEdit,
            logger,
            collectorOptions: { time: config.blackjack.lobbyTimeout.default },
            render: renderLobbyView
        })
        game.lobbySession = lobbySession

        lobbySession.updateState({
            status: "waiting",
            footerText: statusConfig.waiting.footer
        })

        await lobbySession.open()
        channel.collector = lobbySession.collector

        const refreshLobbyView = () => lobbySession.scheduleRefresh()

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
                await lobbySession.refresh({ force: true })
            }
        })

        lobbySession.registerComponentHandler("bj:join", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    content: "❌ This table is no longer available.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to notify user about unavailable table")
                )
                return
            }

            if (ctx.__stopping) {
                await interactionComponent.reply({
                    content: "❌ This table is closing. Please wait for the next lobby.",
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
                    content: "❌ We could not load your profile right now. Please try again later.",
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
                    content: "⚠️ This table is already full.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about full table")
                )
                return
            }

            if (ctx.GetPlayer(interactionComponent.user.id)) {
                await interactionComponent.reply({
                    content: "⚠️ You are already seated at this table.",
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
                    content: "❌ This table has just been closed. Please join the next lobby.",
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
                    content: "❌ Please enter a valid buy-in amount.",
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
                    content: `❌ ${messages[buyInResult.reason] || "Unable to process your buy-in."}`,
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
                    content: addResult?.reason === "stopping"
                        ? "❌ The table was closed before we could seat you. No chips were taken."
                        : "❌ Unable to seat you right now. Please try again.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to reply about rejected blackjack join", {
                        phase: "lobby",
                        reason: addResult?.reason || "unknown"
                    })
                )
                return
            }
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
                    content: "❌ This table is no longer available.",
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
                    content: "⚠️ You are not seated at this table.",
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
            queueAutoStart()
            refreshLobbyView()

            await interactionComponent.followUp({
                content: "✅ You left the table.",
                flags: MessageFlags.Ephemeral
            }).catch(
                logLobbyInteraction(interactionComponent, "Failed to confirm table leave")
            )
        })

        lobbySession.registerComponentHandler("bj:start", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    content: "❌ This table is no longer available.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (start)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    content: "❌ Only the host can start the game.",
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
                    content: `⚠️ You need at least ${MIN_PLAYERS_TO_START} players before starting.`,
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
                    content: "❌ This table is no longer available.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (cancel)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    content: "❌ Only the host can cancel the game.",
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
                    content: "❌ This table is no longer available.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to warn about unavailable table (settings)")
                )
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    content: "❌ Only the host can change the table speed.",
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

            if (typeof ctx.updateActionTimeoutFromSeconds !== "function") {
                await interactionComponent.reply({
                    content: "❌ Table speed adjustments are unavailable right now.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(interactionComponent, "Failed to reply when action timeout update unavailable")
                )
                return
            }

            const currentSeconds = Math.max(
                1,
                Math.round(
                    (Number.isFinite(ctx.actionTimeoutMs) ? ctx.actionTimeoutMs : config.blackjack.actionTimeout.default) / 1000
                )
            )
            const modalId = `bj:settings:${interactionComponent.id}`
            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle("Table Settings")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("actionTimeout")
                            .setLabel("Action time (seconds)")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(String(currentSeconds))
                    )
                )

            const submission = await lobbySession.presentModal(interactionComponent, modal)
            if (!submission) {
                return
            }

            const rawValue = submission.fields.getTextInputValue("actionTimeout")
            const parsedSeconds = features.inputConverter(rawValue)
            if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
                await submission.reply({
                    content: "❌ Please enter a valid number of seconds.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to warn about invalid action timeout", { phase: "lobby" })
                )
                return
            }

            const updateResult = ctx.updateActionTimeoutFromSeconds(parsedSeconds)
            if (!updateResult?.ok) {
                await submission.reply({
                    content: "❌ Unable to update the table speed.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildCommandInteractionLog(submission, "Failed to reply after action timeout update error", { phase: "lobby" })
                )
                return
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

            await submission.reply({
                content: `⏱️ Table speed updated to **${seconds}s**${note}.`,
                flags: MessageFlags.Ephemeral
            }).catch(
                buildCommandInteractionLog(submission, "Failed to confirm action timeout update", { phase: "lobby" })
            )
            lobbySession.scheduleRefresh()
        })

    } catch (error) {
        logger.error("Blackjack command failed", {
            scope: "commands",
            command: "blackjack",
            userId: interaction.user.id,
            error: error.message,
            stack: error.stack
        })

        if (channel?.game) {
            await channel.game.Stop({ notify: false }).catch(
                buildStopLogHandler(channel.id, "command-error-cleanup")
            )
        }

        await replyOrEdit({
            content: "❌ An error occurred while starting the game. Please try again later.",
            flags: MessageFlags.Ephemeral
        })

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
    .addStringOption((option) =>
        option
            .setName("minbet")
            .setDescription("Minimum bet required to join the table (supports shorthand like 10k).")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("maxplayers")
            .setDescription("Maximum number of players (1-7).")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(7)
    )

module.exports = createCommand({
    name: "blackjack",
    description: "Start a blackjack game in the current channel.",
    slashCommand,
    deferEphemeral: false,
    execute: runBlackjack
})

//play <minBet> [maxPlayers]
