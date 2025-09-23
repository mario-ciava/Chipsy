const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const TexasGame = require("../games/texasGame.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession } = require("../lobbies")
const config = require("../../config")

const testerProvisionConfig = {
    testerUserId: config.testing?.texas?.testerUserId,
    bankrollEnvKey: "TEXAS_TEST_BANKROLL",
    defaultBankroll: bankrollManager.DEFAULT_TESTER_BANKROLL,
    bankrollAmount: config.testing?.texas?.bankroll
}

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

    const replyOrEdit = (payload = {}) => {
        const finalPayload = { ...payload, allowedMentions: { parse: [] } }
        return sendInteractionResponse(interaction, finalPayload)
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

    try {
        const minBetRaw = interaction.options.getString("minbet", true)
        const maxPlayersInput = interaction.options.getInteger("maxplayers")

        const minBet = features.inputConverter(minBetRaw)

        if (!Number.isFinite(minBet) || minBet <= 0) {
            await replyOrEdit({
                content: `❌ ${interaction.user.tag}, the minimum bet must be a positive number.`,
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const normalizedMaxPlayers = Number.isInteger(maxPlayersInput)
            ? Math.min(Math.max(maxPlayersInput, 2), 9)
            : 9

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating Texas Hold'em game", {
            scope: "commands",
            command: "texas",
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            channelId: channel.id
        })

        const messageAdapter = {
            author: interaction.user,
            channel: interaction.channel,
            client
        }

        game = new TexasGame({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            maxBuyIn
        });
        registerGame(client, game)
        channel.game = game

        const hostId = interaction.user.id
        const hostMention = `<@${hostId}>`

        const formatPlayers = () => {
            const players = game?.players || []
            if (!players.length) return "—"
            return players
                .map(p => `<@${p.id}> - ${setSeparator(p.stack)}$`)
                .join("\n")
        }

        const statusConfig = {
            waiting: { color: Colors.Green, footer: "Waiting for players..." },
            starting: { color: Colors.Blurple, footer: "Starting the game..." },
            canceled: { color: Colors.Red, footer: "Game canceled." },
            ended: { color: Colors.DarkGrey, footer: "Game ended." }
        }

        const renderLobbyView = ({ state }) => {
            const players = game?.players || []
            const maxPlayersLimit = game?.maxPlayers || 9
            const palette = statusConfig[state.status] || statusConfig.waiting
            const playerCountLabel = `${players.length}/${maxPlayersLimit}`
            const tableIsFull = players.length >= maxPlayersLimit
            const hasPlayers = players.length > 1
            const actionTimeoutSeconds = Math.round((game?.actionTimeoutMs || config.texas.actionTimeout.default) / 1000)

            const embed = new EmbedBuilder()
                .setColor(palette.color)
                .setTitle("♠️ Texas Hold'em — Lobby")
                .setDescription("Press **Join** to buy in. The host can start when at least 2 players have joined.")
                .addFields(
                    { name: `👥 Players [${playerCountLabel}]`, value: formatPlayers(), inline: false },
                    { name: "💰 Requirements", value: `Min buy-in: ${setSeparator(game.minBuyIn)}
Max buy-in: ${setSeparator(game.maxBuyIn)}
Small/Big Blind: ${setSeparator(game.minBet / 2)}/${setSeparator(game.minBet)}`, inline: false },
                    { name: "👑 Host", value: hostMention, inline: true },
                    { name: "⏱️ Table speed", value: `${actionTimeoutSeconds}s per action`, inline: true }
                )
                .setFooter({ text: state.footerText || palette.footer })
                .setTimestamp()

            const components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId("tx:join").setLabel("Join").setStyle(ButtonStyle.Success).setDisabled(tableIsFull),
                    new ButtonBuilder().setCustomId("tx:leave").setLabel("Leave").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId("tx:start").setLabel("Start").setStyle(ButtonStyle.Primary).setDisabled(!hasPlayers),
                    new ButtonBuilder().setCustomId("tx:cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId("tx:settings").setLabel("Settings").setStyle(ButtonStyle.Secondary)
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

        const lobbySession = createLobbySession({
            send: replyOrEdit,
            logger,
            collectorOptions: { time: 5 * 60 * 1000 },
            render: renderLobbyView
        })

        lobbySession.updateState({ status: "waiting" })
        await lobbySession.open()
        channel.collector = lobbySession.collector

        const startGame = async ({ initiatedBy } = {}) => {
            if (lobbySession.isClosed) return
            const footer = initiatedBy ? `Game starting — triggered by ${initiatedBy}` : "Starting..."
            lobbySession.updateState({ status: "starting", footerText: footer })
            await lobbySession.close({ reason: "started" })
            try {
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
                await lobbySession.refresh({ force: true })
            }
        })

        lobbySession.registerComponentHandler("tx:join", async (i) => {
            if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", flags: MessageFlags.Ephemeral })

            try {
                await ensureUserData(i.user)
            } catch (error) {
                if (error.message === "user-data-unavailable") return
                const responder = i.deferred || i.replied
                    ? i.followUp.bind(i)
                    : i.reply.bind(i)
                await responder({
                    content: "❌ We could not load your profile right now. Please try again later.",
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logLobbyInteraction(i, "Failed to respond after user data error")
                )
                return
            }
            await bankrollManager.ensureTesterProvision({
                user: i.user,
                client,
                testerUserId: testerProvisionConfig.testerUserId,
                bankrollEnvKey: testerProvisionConfig.bankrollEnvKey,
                defaultBankroll: testerProvisionConfig.defaultBankroll,
                bankrollAmount: testerProvisionConfig.bankrollAmount
            })

            if (game.players.length >= game.maxPlayers) return i.reply({ content: "⚠️ This table is full.", flags: MessageFlags.Ephemeral })
            if (game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are already at this table.", flags: MessageFlags.Ephemeral })

            const modal = new ModalBuilder().setCustomId(`tx:modal:${i.id}`).setTitle("Join Table").addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId("buyin").setLabel("Buy-in Amount").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(game.minBuyIn))
                )
            )

            const submission = await lobbySession.presentModal(i, modal)
            if (!submission) return

            const rawBuyIn = submission.fields.getTextInputValue("buyin")
            const parsedBuyIn = features.inputConverter(rawBuyIn)
            const buyInResult = bankrollManager.normalizeBuyIn({ requested: parsedBuyIn, minBuyIn: game.minBuyIn, maxBuyIn: game.maxBuyIn, bankroll: bankrollManager.getBankroll(submission.user) })

            if (!buyInResult.ok) {
                return submission.reply({ content: `❌ ${buyInResult.reason}`, flags: MessageFlags.Ephemeral })
            }

            const added = await game.AddPlayer(submission.user, { buyIn: buyInResult.amount })
            if (!added) {
                await submission.reply({ content: "❌ Unable to join this table. Please try again.", flags: MessageFlags.Ephemeral })
                return
            }
            game.rememberPlayerInteraction(submission.user.id, submission)
            await submission.reply({ content: `✅ You joined with **${setSeparator(buyInResult.amount)}$**.`, flags: MessageFlags.Ephemeral })
            lobbySession.scheduleRefresh()
        })

        lobbySession.registerComponentHandler("tx:leave", async (i) => {
            if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", flags: MessageFlags.Ephemeral })
            if (!game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are not at this table.", flags: MessageFlags.Ephemeral })
            
            const removed = await game.RemovePlayer(i.user)
            if (removed) {
                await i.reply({ content: "✅ You have left the table.", flags: MessageFlags.Ephemeral })
                lobbySession.scheduleRefresh()
            } else {
                await i.reply({ content: "❌ Failed to leave the table. Please try again.", flags: MessageFlags.Ephemeral })
            }
        })

        lobbySession.registerComponentHandler("tx:start", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can start the game.", flags: MessageFlags.Ephemeral })
            if (game.players.length < game.getMinimumPlayers()) return i.reply({ content: `⚠️ You need at least ${game.getMinimumPlayers()} players to start.`, flags: MessageFlags.Ephemeral })
            
            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            startGame({ initiatedBy: i.user.tag })
        })

        lobbySession.registerComponentHandler("tx:settings", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change the table speed.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const modal = new ModalBuilder()
                .setCustomId(`tx:settings:${i.id}`)
                .setTitle("Table Settings")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("actionTimeout")
                            .setLabel("Tempo per azione (secondi)")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(String(Math.round(game.actionTimeoutMs / 1000)))
                    )
                )

            const submission = await lobbySession.presentModal(i, modal)
            if (!submission) return

            const rawValue = submission.fields.getTextInputValue("actionTimeout")
            const parsedSeconds = features.inputConverter(rawValue)
            if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
                await submission.reply({ content: "❌ Inserisci un numero valido di secondi.", flags: MessageFlags.Ephemeral })
                return
            }

            const updateResult = game.updateActionTimeoutFromSeconds(parsedSeconds)
            if (!updateResult.ok) {
                await submission.reply({ content: "❌ Impossibile aggiornare il timer.", flags: MessageFlags.Ephemeral })
                return
            }

            game.rememberPlayerInteraction(submission.user.id, submission)
            const seconds = Math.round(updateResult.value / 1000)
            const limits = game.getActionTimeoutLimits()
            const minSeconds = Math.round(limits.min / 1000)
            const maxSeconds = Math.round(limits.max / 1000)
            const note = updateResult.clamped
                ? ` (range consentito ${minSeconds}-${maxSeconds}s)`
                : ""

            await submission.reply({
                content: `⏱️ Tempo per azione aggiornato a **${seconds}s**${note}.`,
                flags: MessageFlags.Ephemeral
            })
            lobbySession.scheduleRefresh()
        })

        lobbySession.registerComponentHandler("tx:cancel", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can cancel the game.", flags: MessageFlags.Ephemeral })

            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            await game.Stop({ reason: "canceled" })
        })

        lobbySession.on("end", async ({ reason }) => {
            if (reason !== "started") {
                await game.Stop({ reason: "canceled" }).catch(
                    buildTexasStopLogger(channel.id, reason || "lobby-end")
                )
            }
        })

    } catch (error) {
        logger.error("Texas command failed", { scope: "commands", command: "texas", error })
        if (game) await game.Stop({ reason: "error" }).catch(buildTexasStopLogger(channel?.id, "command-error"))
        await replyOrEdit({ content: "❌ An error occurred. Please try again.", flags: MessageFlags.Ephemeral })
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
    .addStringOption(o => o.setName("minbet").setDescription("Minimum bet (Small/Big Blind will be MinBet/2 and MinBet).").setRequired(true))
    .addIntegerOption(o => o.setName("maxplayers").setDescription("Maximum number of players (2-9).").setMinValue(2).setMaxValue(9).setRequired(false))

module.exports = createCommand({
    name: "texas",
    description: "Start a Texas Hold'em game.",
    slashCommand,
    deferEphemeral: false,
    execute: runTexas
})
