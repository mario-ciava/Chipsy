const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const TexasGame = require("../games/texasGame.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const createCommand = require("../utils/createCommand")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession } = require("../lobbies")

const testerProvisionConfig = {
    testerUserId: process.env.TEXAS_TEST_USER_ID,
    bankrollEnvKey: "TEXAS_TEST_BANKROLL",
    defaultBankroll: bankrollManager.DEFAULT_TESTER_BANKROLL
}

const runTexas = async(interaction, client) => {
    const channel = interaction.channel

    const replyOrEdit = async(payload) => {
        const finalPayload = { ...payload, allowedMentions: { parse: [] } }
        if (interaction.deferred && !interaction.replied) {
            return await interaction.editReply(finalPayload)
        } else if (!interaction.replied) {
            return await interaction.reply(finalPayload)
        } else {
            return await interaction.followUp(finalPayload)
        }
    }

    if (channel.game) {
        await replyOrEdit({
            embeds: [new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${interaction.user.tag}, access denied: a game is already in progress in this channel.`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    let game = null

    try {
        const minBetRaw = interaction.options.getString("minbet", true)
        const maxPlayersInput = interaction.options.getInteger("maxplayers")

        const minBet = features.inputConverter(minBetRaw)

        if (!Number.isFinite(minBet) || minBet <= 0) {
            await replyOrEdit({
                content: `❌ ${interaction.user.tag}, the minimum bet must be a positive number.`,
                flags: Discord.MessageFlags.Ephemeral
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
        })
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
            waiting: { color: Discord.Colors.Green, footer: "Waiting for players..." },
            starting: { color: Discord.Colors.Blurple, footer: "Starting the game..." },
            canceled: { color: Discord.Colors.Red, footer: "Game canceled." },
            ended: { color: Discord.Colors.DarkGrey, footer: "Game ended." }
        }

        const renderLobbyView = ({ state }) => {
            const players = game?.players || []
            const maxPlayersLimit = game?.maxPlayers || 9
            const palette = statusConfig[state.status] || statusConfig.waiting
            const playerCountLabel = `${players.length}/${maxPlayersLimit}`
            const tableIsFull = players.length >= maxPlayersLimit
            const hasPlayers = players.length > 1

            const embed = new Discord.EmbedBuilder()
                .setColor(palette.color)
                .setTitle("♠️ Texas Hold'em — Lobby")
                .setDescription("Press **Join** to buy in. The host can start when at least 2 players have joined.")
                .addFields(
                    { name: `👥 Players [${playerCountLabel}]`, value: formatPlayers(), inline: false },
                    { name: "💰 Requirements", value: `Min buy-in: ${setSeparator(game.minBuyIn)}
Max buy-in: ${setSeparator(game.maxBuyIn)}
Small/Big Blind: ${setSeparator(game.minBet / 2)}/${setSeparator(game.minBet)}`, inline: false },
                    { name: "👑 Host", value: hostMention, inline: true }
                )
                .setFooter({ text: state.footerText || palette.footer })
                .setTimestamp()

            const components = [
                new Discord.ActionRowBuilder().addComponents(
                    new Discord.ButtonBuilder().setCustomId("tx:join").setLabel("Join").setStyle(Discord.ButtonStyle.Success).setDisabled(tableIsFull),
                    new Discord.ButtonBuilder().setCustomId("tx:leave").setLabel("Leave").setStyle(Discord.ButtonStyle.Secondary),
                    new Discord.ButtonBuilder().setCustomId("tx:start").setLabel("Start").setStyle(Discord.ButtonStyle.Primary).setDisabled(!hasPlayers),
                    new Discord.ButtonBuilder().setCustomId("tx:cancel").setLabel("Cancel").setStyle(Discord.ButtonStyle.Danger)
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
                await game.Stop({ reason: "error", notify: false }).catch(() => {})
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
            if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", ephemeral: true })

            try {
                await ensureUserData(i.user)
            } catch (error) {
                if (error.message === "user-data-unavailable") return
                const responder = i.deferred || i.replied
                    ? i.followUp.bind(i)
                    : i.reply.bind(i)
                await responder({
                    content: "❌ We could not load your profile right now. Please try again later.",
                    ephemeral: true
                }).catch(() => null)
                return
            }
            
            await bankrollManager.ensureTesterProvision({ user: i.user, client, ...testerProvisionConfig })
            
            if (game.players.length >= game.maxPlayers) return i.reply({ content: "⚠️ This table is full.", ephemeral: true })
            if (game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are already at this table.", ephemeral: true })

            const modal = new Discord.ModalBuilder().setCustomId(`tx:modal:${i.id}`).setTitle("Join Table").addComponents(
                new Discord.ActionRowBuilder().addComponents(
                    new Discord.TextInputBuilder().setCustomId("buyin").setLabel("Buy-in Amount").setStyle(Discord.TextInputStyle.Short).setRequired(true).setValue(String(game.minBuyIn))
                )
            )

            const submission = await lobbySession.presentModal(i, modal)
            if (!submission) return

            const rawBuyIn = submission.fields.getTextInputValue("buyin")
            const parsedBuyIn = features.inputConverter(rawBuyIn)
            const buyInResult = bankrollManager.normalizeBuyIn({ requested: parsedBuyIn, minBuyIn: game.minBuyIn, maxBuyIn: game.maxBuyIn, bankroll: bankrollManager.getBankroll(submission.user) })

            if (!buyInResult.ok) {
                return submission.reply({ content: `❌ ${buyInResult.reason}`, ephemeral: true })
            }

            await game.AddPlayer(submission.user, { buyIn: buyInResult.amount })
            await submission.reply({ content: `✅ You joined with **${setSeparator(buyInResult.amount)}$**.`, ephemeral: true })
            lobbySession.scheduleRefresh()
        })

        lobbySession.registerComponentHandler("tx:leave", async (i) => {
            if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", ephemeral: true })
            if (!game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are not at this table.", ephemeral: true })
            
            await game.RemovePlayer(i.user)
            await i.reply({ content: "✅ You have left the table.", ephemeral: true })
            lobbySession.scheduleRefresh()
        })

        lobbySession.registerComponentHandler("tx:start", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can start the game.", ephemeral: true })
            if (game.players.length < 2) return i.reply({ content: "⚠️ You need at least two players to start.", ephemeral: true })
            
            await i.deferUpdate()
            startGame({ initiatedBy: i.user.tag })
        })

        lobbySession.registerComponentHandler("tx:cancel", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can cancel the game.", ephemeral: true })

            await i.deferUpdate()
            await game.Stop({ reason: "canceled", notify: false })
        })

        lobbySession.on("end", async ({ reason }) => {
            if (reason !== "started") {
                await game.Stop({ reason: "canceled", notify: false }).catch(() => {})
            }
        })

    } catch (error) {
        logger.error("Texas command failed", { scope: "commands", command: "texas", error })
        if (game) await game.Stop({ notify: false }).catch(() => {})
        await replyOrEdit({ content: "❌ An error occurred. Please try again.", flags: Discord.MessageFlags.Ephemeral })
    } finally {
        if (channel) channel.collector = null
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