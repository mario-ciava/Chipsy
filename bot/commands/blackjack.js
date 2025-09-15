const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const BlackJack = require("../games/blackjackGame.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const createCommand = require("../utils/createCommand")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession } = require("../lobbies")
const config = require("../../config")

const testerProvisionConfig = {
    testerUserId: process.env.BLACKJACK_TEST_USER_ID,
    bankrollEnvKey: "BLACKJACK_TEST_BANKROLL",
    defaultBankroll: bankrollManager.DEFAULT_TESTER_BANKROLL
}
const AUTO_START_DELAY_MS = config.lobby.autoStartDelay.default
/**
 * Run blackjack game - uses Discord.js native interaction API.
 * Clean, simple, no abstractions.
 */
const runBlackjack = async(interaction, client) => {
    const channel = interaction.channel

    const replyOrEdit = async(payload) => {
        const finalPayload = { ...payload }
        if (!finalPayload.allowedMentions) {
            finalPayload.allowedMentions = { parse: [] }
        }

        if (interaction.deferred && !interaction.replied) {
            return await interaction.editReply(finalPayload)
        } else if (!interaction.replied) {
            return await interaction.reply(finalPayload)
        } else {
            return await interaction.followUp(finalPayload)
        }
    }

    if (channel.__blackjackStarting) {
        await replyOrEdit({
            embeds: [new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Orange)
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
            embeds: [new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
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
                flags: Discord.MessageFlags.Ephemeral
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
                    const stack = Number.isFinite(player?.stack) ? setSeparator(player.stack) : '0'
                    return `${mention} - ${stack}$`
                })
                .join("\n")
        }

        const statusConfig = {
            waiting: {
                color: Discord.Colors.Green,
                footer: "Waiting for players…"
            },
            starting: {
                color: Discord.Colors.Blurple,
                footer: "Starting the game…"
            },
            canceled: {
                color: Discord.Colors.Red,
                footer: "Game canceled."
            },
            ended: {
                color: Discord.Colors.DarkGrey,
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
            const hasPlayers = players.length > 0

            const playerCountLabel = Number.isFinite(maxPlayersLimit)
                ? `${players.length}/${maxPlayersLimit}`
                : `${players.length}`
            const playersFieldName = `👥 Players [${playerCountLabel}]`

            const embed = new Discord.EmbedBuilder()
                .setColor(palette.color)
                .setTitle("🃏 Blackjack — Lobby")
                .setDescription("Press **Join** to buy in and take a seat. When everyone is ready, the host can press **Start**.")
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
                    }
                )
                .setFooter({ text: footerText })
                .setTimestamp()

            if (manager.isClosed) {
                return { embeds: [embed], components: [] }
            }

            const components = [
                new Discord.ActionRowBuilder().addComponents(
                    new Discord.ButtonBuilder()
                        .setCustomId("bj:join")
                        .setLabel("Join")
                        .setStyle(Discord.ButtonStyle.Success)
                        .setDisabled(playing || tableIsFull),
                    new Discord.ButtonBuilder()
                        .setCustomId("bj:leave")
                        .setLabel("Leave")
                        .setStyle(Discord.ButtonStyle.Secondary)
                        .setDisabled(!hasPlayers || playing),
                    new Discord.ButtonBuilder()
                        .setCustomId("bj:start")
                        .setLabel("Start")
                        .setStyle(Discord.ButtonStyle.Primary)
                        .setDisabled(!hasPlayers || playing),
                    new Discord.ButtonBuilder()
                        .setCustomId("bj:cancel")
                        .setLabel("Cancel")
                        .setStyle(Discord.ButtonStyle.Danger)
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
                            flags: Discord.MessageFlags.SuppressNotifications
                        }).catch(() => null)
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
            if (!ctx.players.length) {
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
                    await game.Stop({ reason: "allPlayersLeft", notify: false }).catch(() => null)
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
                await game.Stop({ reason: "error", notify: false }).catch(() => null)
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
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
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
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            await bankrollManager.ensureTesterProvision({
                user: interactionComponent.user,
                client,
                testerUserId: testerProvisionConfig.testerUserId,
                bankrollEnvKey: testerProvisionConfig.bankrollEnvKey,
                defaultBankroll: testerProvisionConfig.defaultBankroll
            })

            const maxSeats = Number.isFinite(ctx.maxPlayers) && ctx.maxPlayers > 0
                ? ctx.maxPlayers
                : Infinity
            if (ctx.players.length >= maxSeats) {
                await interactionComponent.reply({
                    content: "⚠️ This table is already full.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            if (ctx.GetPlayer(interactionComponent.user.id)) {
                await interactionComponent.reply({
                    content: "⚠️ You are already seated at this table.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            const baseMessageId = lobbySession.message?.id || interactionComponent.message?.id || `msg:${Date.now()}`
            const modalCustomId = `bj:modal:${baseMessageId}:${interactionComponent.user.id}`
            const modal = new Discord.ModalBuilder()
                .setCustomId(modalCustomId)
                .setTitle("Join the table")
                .addComponents(
                    new Discord.ActionRowBuilder().addComponents(
                        new Discord.TextInputBuilder()
                            .setCustomId("buyin")
                            .setLabel("Buy-in amount")
                            .setStyle(Discord.TextInputStyle.Short)
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

            const rawBuyIn = submission.fields.getTextInputValue("buyin")?.trim()
            const parsedBuyIn = rawBuyIn ? features.inputConverter(rawBuyIn) : ctx.minBuyIn
            if (!Number.isFinite(parsedBuyIn) || parsedBuyIn <= 0) {
                await submission.reply({
                    content: "❌ Please enter a valid buy-in amount.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
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
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            await ctx.AddPlayer(submission.user, { buyIn: buyInResult.amount })
            queueAutoStart()

            // Acknowledge submission silently
            await submission.deferUpdate().catch(() => null)

            refreshLobbyView()
        })

        lobbySession.registerComponentHandler("bj:leave", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    content: "❌ This table is no longer available.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            await interactionComponent.deferUpdate().catch(() => null)
            const player = ctx.GetPlayer(interactionComponent.user.id)
            if (!player) {
                await interactionComponent.followUp({
                    content: "⚠️ You are not seated at this table.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            await ctx.RemovePlayer(interactionComponent.user)
            if (!ctx.players.length) {
                lobbySession.clearAutoTrigger()
            }
            refreshLobbyView()

            await interactionComponent.followUp({
                content: "✅ You left the table.",
                flags: Discord.MessageFlags.Ephemeral
            }).catch(() => null)
        })

        lobbySession.registerComponentHandler("bj:start", async(interactionComponent) => {
            const ctx = resolveGameContext()
            if (!ctx || lobbySession.isClosed) {
                await interactionComponent.reply({
                    content: "❌ This table is no longer available.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    content: "❌ Only the host can start the game.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(() => null)
                    }, 5000)
                }
                return
            }

            if (!ctx.players.length) {
                const reply = await interactionComponent.reply({
                    content: "⚠️ You need at least one player before starting.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(() => null)
                    }, 5000)
                }
                return
            }

            await interactionComponent.deferUpdate().catch(() => null)
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
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                return
            }

            if (interactionComponent.user.id !== hostId) {
                const reply = await interactionComponent.reply({
                    content: "❌ Only the host can cancel the game.",
                    flags: Discord.MessageFlags.Ephemeral
                }).catch(() => null)
                if (reply) {
                    setTimeout(() => {
                        interactionComponent.deleteReply().catch(() => null)
                    }, 5000)
                }
                return
            }

            await interactionComponent.deferUpdate().catch(() => null)
            lobbySession.clearAutoTrigger()
            lobbySession.updateState({ status: "canceled", footerText: statusConfig.canceled.footer })
            await lobbySession.close({ status: "canceled", reason: "canceled" })
            await game.Stop({ reason: "canceled", notify: false })
        })

        lobbySession.on("end", async({ reason }) => {
            if (reason === "started") return
            if (lobbySession.isClosed) return
            lobbySession.clearAutoTrigger()
            const footer = reason === "time"
                ? "Lobby closed due to inactivity."
                : statusConfig.canceled.footer
            lobbySession.updateState({ status: "canceled", footerText: footer })
            await game.Stop({ reason: "canceled", notify: false }).catch(() => null)
        })

        lobbySession.on("error", (collectorError) => {
            logger.error("Component collector error", {
                scope: "commands",
                command: "blackjack",
                channelId: channel.id,
                error: collectorError.message
            })
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
            await channel.game.Stop({ notify: false }).catch(() => null)
        }

        await replyOrEdit({
            content: "❌ An error occurred while starting the game. Please try again later.",
            flags: Discord.MessageFlags.Ephemeral
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
