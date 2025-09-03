const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const BlackJack = require("../games/blackjackGame.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const createCommand = require("../utils/createCommand")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { delay } = require("../utils/async")

const testerProvisionConfig = {
    testerUserId: process.env.BLACKJACK_TEST_USER_ID,
    bankrollEnvKey: "BLACKJACK_TEST_BANKROLL",
    defaultBankroll: bankrollManager.DEFAULT_TESTER_BANKROLL
}
/**
 * Run blackjack game - uses Discord.js native interaction API.
 * Clean, simple, no abstractions.
 */
const runBlackjack = async(interaction, client) => {
    const channel = interaction.channel

    const replyOrEdit = async(payload) => {
        if (interaction.deferred && !interaction.replied) {
            return await interaction.editReply(payload)
        } else if (!interaction.replied) {
            return await interaction.reply(payload)
        } else {
            return await interaction.followUp(payload)
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

    try {
        // Use Discord.js native option getters - clean and type-safe!
        const minBetRaw = interaction.options.getString('minbet', true) // Required
        const maxPlayersInput = interaction.options.getInteger('maxplayers') // Optional, already number!

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

        // maxPlayers is already validated by Discord (min: 1, max: 7) or defaults to 7
        const maxPlayers = maxPlayersInput ?? 7

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating BlackJack game", {
            scope: "commands",
            command: "blackjack",
            minBet: safeMinBet,
            maxPlayers,
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
            maxPlayers,
            maxBuyIn
        })
        registerGame(client, channel.game)
        const buildGameEmbed = () => {
            const players = channel.game?.players || []
            const maxPlayersLimit = channel.game?.maxPlayers || 7
            return new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Green)
                .addFields(
                    { name: "🃏 Blackjack game created", value: "", inline: false },
                    { name: `👥 Players [${players.length}/${maxPlayersLimit}]`, value: `${players.join(", ") || "-"}`, inline: true },
                    {
                        name: "💰 Requirements",
                        value: `Min buy-in: ${setSeparator(channel.game.minBuyIn)}$\nMax buy-in: ${setSeparator(channel.game.maxBuyIn)}$\nMinimum bet: ${setSeparator(channel.game.minBet)}$`,
                        inline: true
                    },
                    {
                        name: "⚙️ Options",
                        value: "Type **join [buy-in-amount]** to join this game\nType **leave** to leave this game",
                        inline: false
                    },
                    {
                        name: "⚠️ Be aware",
                        value: "If you leave while playing, you will lose your bet on the table\nIf all the players leave, the game will be stopped",
                        inline: false
                    }
                )
                .setFooter({ text: "Starting in 30 seconds.." })
        }

        const statusMessage = await replyOrEdit({ embeds: [buildGameEmbed()] })

        channel.collector = channel.createMessageCollector({
            filter: (mess) => !mess.author.bot && (mess.content.toLowerCase().startsWith("join") || mess.content.toLowerCase() === "leave")
        })

        channel.collector.on("error", (error) => {
            logger.error("Message collector error", {
                scope: "commands",
                command: "blackjack",
                channelId: channel.id,
                error: error.message
            })
        })

        channel.collector.on("collect", async(mess) => {
            try {
                if (!mess.author.data) {
                    const result = await client.SetData(mess.author)
                    if (result.error) {
                        if (result.error.type === "database") {
                            await channel.send({
                                content: `❌ ${mess.author.tag}, database connection error. Please try again later.`
                            }).catch(() => null)
                        }
                        return
                    }
                    if (!result.data) return
                }

                await bankrollManager.ensureTesterProvision({
                    user: mess.author,
                    client,
                    testerUserId: testerProvisionConfig.testerUserId,
                    bankrollEnvKey: testerProvisionConfig.bankrollEnvKey,
                    defaultBankroll: testerProvisionConfig.defaultBankroll
                })
                const [action, valueToken] = mess.content.trim().toLowerCase().split(/\s+/)

                if (action === "join") {
                    let requestedBuyIn
                    if (valueToken) {
                        const parsedValue = features.inputConverter(valueToken)
                        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
                            await channel.send(`❌ ${mess.author.tag}, invalid buy-in amount.`).catch(() => null)
                            return
                        }
                        requestedBuyIn = parsedValue
                    }

                    const buyInResult = bankrollManager.normalizeBuyIn({
                        requested: requestedBuyIn,
                        minBuyIn: channel.game.minBuyIn,
                        maxBuyIn: channel.game.maxBuyIn,
                        bankroll: mess.author.data.money
                    })

                    if (!buyInResult.ok) {
                        const messages = {
                            invalidAmount: "your buy-in is not in the allowed range",
                            outOfRange: "your buy-in is not in the allowed range",
                            insufficientBankroll: "not enough funds in your bankroll"
                        }
                        await channel.send(`❌ ${mess.author.tag}, ${messages[buyInResult.reason] || "unable to process buy-in"}`).catch(() => null)
                        return
                    }

                    await channel.game.AddPlayer(mess.author, { buyIn: buyInResult.amount })
                } else if (action === "leave") {
                    await channel.game.RemovePlayer(mess.author)
                }

                if (!channel.game) return

                await statusMessage.edit({ embeds: [buildGameEmbed()] }).catch((error) => {
                    logger.error("Failed to edit game status", {
                        scope: "commands",
                        command: "blackjack",
                        error: error.message
                    })
                })

                if (mess.deletable) {
                    mess.delete().catch(() => null)
                }
            } catch (collectorError) {
                logger.error("Collector handler error", {
                    scope: "commands",
                    command: "blackjack",
                    error: collectorError.message
                })
            }
        })

        await delay(30000)
        if (!channel.game || channel.game.playing) return
        if (channel.game.players.length > 0) {
            channel.game.Run()
        } else {
            channel.game.Stop({ reason: "allPlayersLeft" })
        }
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
