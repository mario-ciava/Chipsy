const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const BlackJack = require("../games/blackjackGame.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const createCommand = require("../utils/createCommand")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})}

const testerProvisionConfig = {
    testerUserId: process.env.BLACKJACK_TEST_USER_ID,
    bankrollEnvKey: "BLACKJACK_TEST_BANKROLL",
    defaultBankroll: bankrollManager.DEFAULT_TESTER_BANKROLL
}
const runBlackjack = async(context) => {
    const msg = context.message
    const channel = msg?.channel

    if (!msg || !channel) {
        await context.replyError("Unable to access the channel for this command.", { ephemeral: true })
        return
    }

    if (!Array.isArray(msg.params)) msg.params = []

    if (channel.__blackjackStarting) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Orange)
            .setFooter({
                text: `${msg.author.tag}, please wait: a blackjack game is already being initialized.`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })
        try {
            await context.reply({ embeds: [embed] })
        } catch (error) {
            logger.error("Failed to notify blackjack initialization in progress", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: channel.id,
                error: error.message,
                stack: error.stack
            })
        }
        return
    }

    if (channel.game) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setFooter({
                text: `${msg.author.tag}, access denied: a game is already existing in this channel`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })
        try {
            await context.reply({ embeds: [embed] })
        } catch (error) {
            logger.error("Failed to notify blackjack game already running", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: channel.id,
                error: error.message,
                stack: error.stack
            })
        }
        return
    }

    channel.__blackjackStarting = true

    try {
        if (!msg.params[0]) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: you must specify the minimum bet amount.`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            await context.reply({ embeds: [embed] })
            return
        }

    const minBet = features.inputConverter(msg.params[0])
    const maxPlayersInput = msg.params[1] !== undefined ? features.inputConverter(msg.params[1]) : undefined

    const createErrorEmbed = (message) => new Discord.EmbedBuilder()
        .setColor(Discord.Colors.Red)
        .setFooter({
            text: `${msg.author.tag}, ${message}`,
            iconURL: msg.author.displayAvatarURL({ extension: "png" })
        })

        if (!Number.isFinite(minBet) || minBet <= 0) {
            await msg.channel.send({
                embeds: [createErrorEmbed("access denied: minimum bet must be a positive number.")]
            }).catch((error) => {
                logger.error("Failed to send blackjack invalid-bet message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
            })
            return
        }

        if (maxPlayersInput !== undefined && (!Number.isFinite(maxPlayersInput) || maxPlayersInput <= 0)) {
            await msg.channel.send({
                embeds: [createErrorEmbed("access denied: maximum number of players must be a positive integer.")]
            }).catch((error) => {
                logger.error("Failed to send blackjack invalid-maxplayers message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
            })
            return
        }

        const maxPlayers = maxPlayersInput !== undefined ? Math.floor(maxPlayersInput) : 7

        if (!Number.isInteger(maxPlayers)) {
            await msg.channel.send({
                embeds: [createErrorEmbed("access denied: maximum number of players must be an integer value.")]
            }).catch((error) => {
                logger.error("Failed to send blackjack non-integer message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
            })
            return
        }

        if (maxPlayers > 7 || maxPlayers < 1) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: maximum number of players must be between 1 and 7`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send blackjack maxplayers-range message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
            })
            return
        }

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.info("Creating BlackJack game instance", {
            scope: "commands",
            command: "blackjack",
            minBet: safeMinBet,
            maxPlayers,
            channelId: channel.id
        })

        try {
            channel.game = new BlackJack({
                message: msg,
                minBet: safeMinBet,
                maxPlayers,
                maxBuyIn
            })
            registerGame(msg.client, channel.game)
            logger.info("BlackJack game instance created successfully", {
                scope: "commands",
                command: "blackjack",
                channelId: channel.id
            })
        } catch (gameError) {
            channel.game = null
            logger.error("Failed to create BlackJack game instance", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: channel.id,
                error: gameError.message,
                stack: gameError.stack
            })
            throw gameError
        }
    const buildGameEmbed = () => {
        const players = channel.game?.players || []
        return new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .addFields(
                { name: "Blackjack ❤", value: "Your game has been created", inline: false },
                { name: `Players [${players.length}] 🤑`, value: `${players.join(", ") || "-"}`, inline: true },
                {
                    name: "Other info 💰",
                    value: `Min buy-in: ${setSeparator(channel.game.minBuyIn)}$\nMax buy-in: ${setSeparator(channel.game.maxBuyIn)}$\nMinimum bet: ${setSeparator(channel.game.minBet)}$`,
                    inline: true
                },
                {
                    name: "Options ⚙",
                    value: "Type **join [buy-in-amount]** to join this game any moment\nType **leave** to leave this game any moment",
                    inline: false
                },
                {
                    name: "Be aware ⚠",
                    value: "If you leave the game while playing, you will lose your bet on the table\nIf all the players leave, the game will be stopped",
                    inline: false
                }
            )
            .setFooter({ text: "30 Seconds left" })
    }
        let statusMessage
        try {
            statusMessage = await context.reply({ embeds: [buildGameEmbed()] })
        } catch (error) {
            logger.error("Failed to send blackjack status message", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: channel.id,
                error: error.message,
                stack: error.stack
            })
            if (msg.channel?.game) {
                try {
                    await msg.channel.game.Stop({ notify: false })
                } catch (stopError) {
                    logger.error("Failed to stop blackjack game after status message error", {
                        scope: "commands",
                        command: "blackjack",
                        error: stopError.message
                    })
                }
            }
            return
        }

        msg.channel.collector = msg.channel.createMessageCollector({
            filter: (mess) => {
                return !mess.author.bot && (mess.content.toLowerCase().startsWith("join") || mess.content.toLowerCase() == "leave")
            }
        })

        msg.channel.collector.on("error", (error) => {
            logger.error("Message collector error in blackjack", {
                scope: "commands",
                command: "blackjack",
                channelId: msg.channel.id,
                error: error.message,
                stack: error.stack
            })
        })

        msg.channel.collector.on("collect", async(mess) => {
            try {
                if (!mess.author.data) {
                    const result = await mess.client.SetData(mess.author)
                    if (result.error) {
                        if (result.error.type === "database") {
                            const embed = new Discord.EmbedBuilder()
                                .setColor(Discord.Colors.Red)
                                .setFooter({
                                    text: `${mess.author.tag}, error: unable to connect to the database.`,
                                    iconURL: mess.author.displayAvatarURL({ extension: "png" })
                                })
                            await mess.channel.send({ embeds: [embed] }).catch(() => null)
                        }
                        return
                    }
                    if (!result.data) return
                }
                await bankrollManager.ensureTesterProvision({
                    user: mess.author,
                    client: mess.client,
                    testerUserId: testerProvisionConfig.testerUserId,
                    bankrollEnvKey: testerProvisionConfig.bankrollEnvKey,
                    defaultBankroll: testerProvisionConfig.defaultBankroll
                })
                const contentParts = mess.content.trim().toLowerCase().split(/\s+/)
                const action = contentParts[0]
                const valueToken = contentParts[1]
                let requestedBuyIn
                if (valueToken !== undefined) {
                    const parsedValue = features.inputConverter(valueToken)
                    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
                        const embed = createErrorEmbed("access denied: invalid buy-in amount.")
                        return await msg.channel.send({ embeds: [embed] }).catch(() => null)
                    }
                    requestedBuyIn = parsedValue
                }
                if (action == "join") {
                    const buyInResult = bankrollManager.normalizeBuyIn({
                        requested: requestedBuyIn,
                        minBuyIn: msg.channel.game.minBuyIn,
                        maxBuyIn: msg.channel.game.maxBuyIn,
                        bankroll: mess.author.data.money
                    })
                    if (!buyInResult.ok) {
                        let denialMessage = "access denied: unable to process your buy-in."
                        if (buyInResult.reason === "invalidAmount" || buyInResult.reason === "outOfRange") {
                            denialMessage = "access denied: your buy-in is not in the allowed range for this game"
                        } else if (buyInResult.reason === "insufficientBankroll") {
                            denialMessage = "access denied: your money must be at least equal or higher than the minimum buy-in"
                        }
                        const embed = new Discord.EmbedBuilder()
                            .setColor(Discord.Colors.Red)
                            .setFooter({
                                text: `${mess.author.tag}, ${denialMessage}`,
                                iconURL: mess.author.displayAvatarURL({ extension: "png" })
                            })
                        return await msg.channel.send({ embeds: [embed] }).catch(() => null)
                    }
                    try {
                        await msg.channel.game.AddPlayer(mess.author, { buyIn: buyInResult.amount })
                    } catch (addError) {
                        logger.error("Failed to add player to blackjack game", {
                            scope: "commands",
                            command: "blackjack",
                            userId: mess.author.id,
                            channelId: msg.channel.id,
                            error: addError.message,
                            stack: addError.stack
                        })
                        return
                    }
                } else {
                    try {
                        await msg.channel.game.RemovePlayer(mess.author)
                    } catch (removeError) {
                        logger.error("Failed to remove player from blackjack game", {
                            scope: "commands",
                            command: "blackjack",
                            userId: mess.author.id,
                            channelId: msg.channel.id,
                            error: removeError.message,
                            stack: removeError.stack
                        })
                        return
                    }
                }

                if (!msg.channel.game) return

                await statusMessage.edit({ embeds: [buildGameEmbed()] }).catch((error) => {
                    logger.error("Failed to edit blackjack status message", {
                        scope: "commands",
                        command: "blackjack",
                        channelId: msg.channel.id,
                        error: error.message
                    })
                })

                if (mess.deletable) {
                    mess.delete().catch((error) => {
                        logger.error("Failed to delete player message in blackjack", {
                            scope: "commands",
                            command: "blackjack",
                            messageId: mess.id,
                            error: error.message
                        })
                    })
                }
            } catch (collectorError) {
                logger.error("Error in blackjack collector handler", {
                    scope: "commands",
                    command: "blackjack",
                    userId: mess.author?.id,
                    channelId: msg.channel.id,
                    error: collectorError.message,
                    stack: collectorError.stack
                })
            }
        })

        await delay(30000)
        if (!msg.channel.game || msg.channel.game.playing) return
        if (msg.channel.game.players.length > 0) msg.channel.game.Run()
            else msg.channel.game.Stop({ reason: "allPlayersLeft" })
    } catch (error) {
        logger.error("Failed to execute blackjack command", {
            scope: "commands",
            command: "blackjack",
            userId: msg.author.id,
            error: error.message,
            stack: error.stack
        })

        if (msg.channel?.game) {
            try {
                await msg.channel.game.Stop({ notify: false })
            } catch (stopError) {
                logger.error("Failed to stop blackjack game after error", {
                    scope: "commands",
                    command: "blackjack",
                    error: stopError.message
                })
            }
        }

        try {
            await msg.channel.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setDescription("❌ An error occurred while starting the blackjack game. Please try again later.")
                ]
            })
        } catch (sendError) {
            logger.error("Failed to send error message", {
                scope: "commands",
                command: "blackjack",
                error: sendError.message
            })
        }
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
    aliases: ["bj"],
    slashCommand,
    deferEphemeral: false,
    errorMessage: "Unable to start a blackjack game right now. Please try again later.",
    execute: async(context) => {
        const message = context.message
        if (message && !Array.isArray(message.params)) {
            message.params = Array.isArray(context.args) ? [...context.args] : []
        }
        await runBlackjack(context)
    }
})

//play <minBet> [maxPlayers]
