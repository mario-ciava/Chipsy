const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const BlackJack = require("../structure/blackjack.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")
const logger = require("../util/logger")
const delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})}
const runBlackjack = async(msg) => {
    try {
        if (!Array.isArray(msg.params)) msg.params = []

        if (!msg.params[0]) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: you must specify the minimum bet amount.`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send blackjack no-bet message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        if (msg.channel.game) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: a game is already existing in this channel`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send blackjack game-exists message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
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
            return await msg.channel.send({
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
                throw error
            })
        }

        if (maxPlayersInput !== undefined && (!Number.isFinite(maxPlayersInput) || maxPlayersInput <= 0)) {
            return await msg.channel.send({
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
                throw error
            })
        }

        const maxPlayers = maxPlayersInput !== undefined ? Math.floor(maxPlayersInput) : 7

        if (!Number.isInteger(maxPlayers)) {
            return await msg.channel.send({
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
                throw error
            })
        }

        if (maxPlayers > 7 || maxPlayers < 1) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: maximum number of players must be between 1 and 7`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send blackjack maxplayers-range message", {
                    scope: "commands",
                    command: "blackjack",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        try {
            msg.channel.game = new BlackJack({
                message: msg,
                minBet: safeMinBet,
                maxPlayers,
                maxBuyIn
            })
        } catch (gameError) {
            logger.error("Failed to create BlackJack game instance", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: msg.channel.id,
                error: gameError.message,
                stack: gameError.stack
            })
            throw gameError
        }
    const buildGameEmbed = () => {
        const players = msg.channel.game?.players || []
        return new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .addFields(
                { name: "Blackjack ❤", value: "Your game has been created", inline: false },
                { name: `Players [${players.length}] 🤑`, value: `${players.join(", ") || "-"}`, inline: true },
                {
                    name: "Other info 💰",
                    value: `Min buy-in: ${setSeparator(msg.channel.game.minBuyIn)}$\nMax buy-in: ${setSeparator(msg.channel.game.maxBuyIn)}$\nMinimum bet: ${setSeparator(msg.channel.game.minBet)}$`,
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
        const statusMessage = await msg.channel.send({ embeds: [buildGameEmbed()] }).catch((error) => {
            logger.error("Failed to send blackjack status message", {
                scope: "commands",
                command: "blackjack",
                userId: msg.author.id,
                channelId: msg.channel.id,
                error: error.message,
                stack: error.stack
            })
            throw error
        })

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
        let cont = mess.content.toLowerCase().split(" ")
        let action = cont[0]
            value = features.inputConverter(cont[1])
                if (action == "join") {
                    if (mess.author.data.money < msg.channel.game.minBuyIn || (!isNaN(value) && mess.author.data.money < value)) {
                        const embed = new Discord.EmbedBuilder()
                            .setColor(Discord.Colors.Red)
                            .setFooter({
                                text: `${mess.author.tag}, access denied: your money must be at least equal or higher than the minimum buy-in`,
                                iconURL: mess.author.displayAvatarURL({ extension: "png" })
                            })
                        return await msg.channel.send({ embeds: [embed] }).catch(() => null)
                    }
                    if (!value) value = msg.channel.game.minBuyIn
                    if (value < msg.channel.game.minBuyIn || value > msg.channel.game.maxBuyIn) {
                        const embed = new Discord.EmbedBuilder()
                            .setColor(Discord.Colors.Red)
                            .setFooter({
                                text: `${mess.author.tag}, access denied: your buy-in is not in the allowed range for this game`
                            })
                        return await msg.channel.send({ embeds: [embed] }).catch(() => null)
                    }
                    mess.author.stack = value

                    try {
                        await msg.channel.game.AddPlayer(mess.author)
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
            else msg.channel.game.Stop()
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
                msg.channel.game.Stop()
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

module.exports = {
    config: {
        name: "blackjack",
        aliases: ["bj"],
        description: "Start a blackjack game in the current channel.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runBlackjack(message)
    }
}

//play <minBet> [maxPlayers]
