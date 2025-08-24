const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const Texas = require("../structure/texas.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")
const logger = require("../util/logger")
const createCommand = require("../util/createCommand")
const delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})}
const { registerGame } = require("../util/gameRegistry")
const runTexas = async(msg) => {
    if (msg?.client?.config?.enabled === false) {
        await msg.channel?.send("The bot is currently disabled by the administrators. Please try again later.").catch(() => null)
        return
    }
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
                logger.error("Failed to send texas no-bet message", {
                    scope: "commands",
                    command: "texas",
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
                logger.error("Failed to send texas game-exists message", {
                    scope: "commands",
                    command: "texas",
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
                logger.error("Failed to send texas invalid-bet message", {
                    scope: "commands",
                    command: "texas",
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
                logger.error("Failed to send texas invalid-maxplayers message", {
                    scope: "commands",
                    command: "texas",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        const maxPlayers = maxPlayersInput !== undefined ? Math.floor(maxPlayersInput) : 9

        if (!Number.isInteger(maxPlayers)) {
            return await msg.channel.send({
                embeds: [createErrorEmbed("access denied: maximum number of players must be an integer value.")]
            }).catch((error) => {
                logger.error("Failed to send texas non-integer message", {
                    scope: "commands",
                    command: "texas",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        if (maxPlayers > 9 || maxPlayers < 2) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setFooter({
                    text: `${msg.author.tag}, access denied: maximum number of players must be between 2 and 9`,
                    iconURL: msg.author.displayAvatarURL({ extension: "png" })
                })
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send texas maxplayers-range message", {
                    scope: "commands",
                    command: "texas",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        const safeMinBet = Math.max(1, Math.floor(minBet))

        try {
            msg.channel.game = new Texas({
                message: msg,
                minBet: safeMinBet,
                maxPlayers
            })
            registerGame(msg.client, msg.channel.game)
        } catch (gameError) {
            logger.error("Failed to create Texas game instance", {
                scope: "commands",
                command: "texas",
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
                    { name: "Texas Hold'em ❤", value: "Your game has been created", inline: false },
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
                .setFooter({ text: "45 Seconds left" })
        }

        const statusMessage = await msg.channel.send({ embeds: [buildGameEmbed()] }).catch((error) => {
            logger.error("Failed to send texas status message", {
                scope: "commands",
                command: "texas",
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
            logger.error("Message collector error in texas", {
                scope: "commands",
                command: "texas",
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
                        logger.error("Failed to add player to texas game", {
                            scope: "commands",
                            command: "texas",
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
                        logger.error("Failed to remove player from texas game", {
                            scope: "commands",
                            command: "texas",
                            userId: mess.author.id,
                            channelId: msg.channel.id,
                            error: removeError.message,
                            stack: removeError.stack
                        })
                        return
                    }
                }

                await statusMessage.edit({ embeds: [buildGameEmbed()] }).catch((error) => {
                    logger.error("Failed to edit texas status message", {
                        scope: "commands",
                        command: "texas",
                        channelId: msg.channel.id,
                        error: error.message
                    })
                })

                if (mess.deletable) {
                    mess.delete().catch((error) => {
                        logger.error("Failed to delete player message in texas", {
                            scope: "commands",
                            command: "texas",
                            messageId: mess.id,
                            error: error.message
                        })
                    })
                }
            } catch (collectorError) {
                logger.error("Error in texas collector handler", {
                    scope: "commands",
                    command: "texas",
                    userId: mess.author?.id,
                    channelId: msg.channel.id,
                    error: collectorError.message,
                    stack: collectorError.stack
                })
            }
        })

        await delay(45000)
        if (msg.channel.game.playing) return
        if (msg.channel.game.players.length > 1) msg.channel.game.Run(true)
            else msg.channel.game.Stop()
    } catch (error) {
        const disabled = msg?.client?.config?.enabled === false
        logger.error("Failed to execute texas command", {
            scope: "commands",
            command: "texas",
            userId: msg.author.id,
            error: error.message,
            stack: error.stack
        })

        if (msg.channel?.game) {
            try {
                await msg.channel.game.Stop({ notify: !disabled })
            } catch (stopError) {
                logger.error("Failed to stop texas game after error", {
                    scope: "commands",
                    command: "texas",
                    error: stopError.message
                })
            }
        }

        if (disabled) {
            try {
                await msg.channel.send({
                    embeds: [
                        new Discord.EmbedBuilder()
                            .setColor(Discord.Colors.Orange)
                            .setDescription("⚠️ Tavolo Texas Hold'em chiuso perché Chipsy è stato disattivato dagli amministratori.")
                    ]
                }).catch(() => null)
            } catch (noticeError) {
                logger.warn("Failed to send texas disable notice", {
                    scope: "commands",
                    command: "texas",
                    error: noticeError.message
                })
            }
            return
        }

        try {
            await msg.channel.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setDescription("❌ An error occurred while starting the Texas Hold'em game. Please try again later.")
                ]
            })
        } catch (sendError) {
            logger.error("Failed to send error message", {
                scope: "commands",
                command: "texas",
                error: sendError.message
            })
        }
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("texas")
    .setDescription("Start a Texas Hold'em game in the current channel.")
    .addStringOption((option) =>
        option
            .setName("minbet")
            .setDescription("Minimum bet required to join the table (supports shorthand like 10k).")
            .setRequired(true)
    )
    .addIntegerOption((option) =>
        option
            .setName("maxplayers")
            .setDescription("Maximum number of players (2-9).")
            .setRequired(false)
            .setMinValue(2)
            .setMaxValue(9)
    )

module.exports = createCommand({
    name: "texas",
    description: "Start a Texas Hold'em game in the current channel.",
    aliases: ["holdem"],
    slashCommand,
    deferEphemeral: false,
    errorMessage: "Unable to start a Texas Hold'em game right now. Please try again later.",
    execute: async(context) => {
        const message = context.message
        if (!Array.isArray(message.params)) {
            message.params = Array.isArray(context.args) ? [...context.args] : []
        }
        await runTexas(message)
    }
})

//play <minBet> [maxPlayers]
