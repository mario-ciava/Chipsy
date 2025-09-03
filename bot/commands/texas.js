const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const Texas = require("../games/texas.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const createCommand = require("../utils/createCommand")
const { delay } = require("../utils/async")
const { registerGame } = require("../utils/gameRegistry")

/**
 * Run Texas Hold'em - uses Discord.js native interaction API.
 * Clean, simple, no abstractions.
 */
const runTexas = async(interaction, client) => {
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

    try {
        // Use Discord.js native option getters - clean and type-safe!
        const minBetRaw = interaction.options.getString('minbet', true)
        const maxPlayersInput = interaction.options.getInteger('maxplayers')

        const minBet = features.inputConverter(minBetRaw)

        // Validation
        if (!Number.isFinite(minBet) || minBet <= 0) {
            await replyOrEdit({
                content: `❌ ${interaction.user.tag}, minimum bet must be a positive number.`,
                flags: Discord.MessageFlags.Ephemeral
            })
            return
        }

        // maxPlayers validated by Discord (min: 2, max: 9) or defaults to 9
        const maxPlayers = maxPlayersInput ?? 9

        const safeMinBet = Math.max(1, Math.floor(minBet))

        logger.debug("Creating Texas Hold'em game", {
            scope: "commands",
            command: "texas",
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

        channel.game = new Texas({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers
        })
        registerGame(client, channel.game)

        const buildGameEmbed = () => {
            const players = channel.game?.players || []
            const maxPlayersLimit = channel.game?.maxPlayers || 9
            return new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Green)
                .addFields(
                    { name: "Texas Hold'em ❤", value: "Your game has been created", inline: false },
                    { name: `Players [${players.length}/${maxPlayersLimit}] 🤑`, value: `${players.join(", ") || "-"}`, inline: true },
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
                .setFooter({ text: "45 Seconds left" })
        }

        const statusMessage = await replyOrEdit({ embeds: [buildGameEmbed()] })

        channel.collector = channel.createMessageCollector({
            filter: (mess) => !mess.author.bot && (mess.content.toLowerCase().startsWith("join") || mess.content.toLowerCase() === "leave")
        })

        channel.collector.on("error", (error) => {
            logger.error("Message collector error", {
                scope: "commands",
                command: "texas",
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
                            await channel.send(`❌ ${mess.author.tag}, database connection error.`).catch(() => null)
                        }
                        return
                    }
                    if (!result.data) return
                }

                const [action, valueToken] = mess.content.trim().toLowerCase().split(/\s+/)

                if (action === "join") {
                    let buyIn = channel.game.minBuyIn
                    if (valueToken) {
                        const parsedValue = features.inputConverter(valueToken)
                        if (Number.isFinite(parsedValue) && parsedValue > 0) {
                            buyIn = parsedValue
                        }
                    }

                    if (mess.author.data.money < buyIn) {
                        await channel.send(`❌ ${mess.author.tag}, insufficient funds for buy-in.`).catch(() => null)
                        return
                    }

                    await channel.game.AddPlayer(mess.author, buyIn)
                } else if (action === "leave") {
                    await channel.game.RemovePlayer(mess.author)
                }

                if (!channel.game) return

                await statusMessage.edit({ embeds: [buildGameEmbed()] }).catch((error) => {
                    logger.error("Failed to edit game status", {
                        scope: "commands",
                        command: "texas",
                        error: error.message
                    })
                })

                if (mess.deletable) {
                    mess.delete().catch(() => null)
                }
            } catch (collectorError) {
                logger.error("Collector handler error", {
                    scope: "commands",
                    command: "texas",
                    error: collectorError.message
                })
            }
        })

        await delay(45000)
        if (!channel.game || channel.game.playing) return
        if (channel.game.players.length > 1) {
            channel.game.Run()
        } else {
            channel.game.Stop({ reason: "allPlayersLeft" })
        }
    } catch (error) {
        logger.error("Texas command failed", {
            scope: "commands",
            command: "texas",
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
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("texas")
    .setDescription("Start a Texas Hold'em game in the current channel.")
    .addStringOption((option) =>
        option
            .setName("minbet")
            .setDescription("Minimum bet required to play (supports shorthand like 10k).")
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
    slashCommand,
    deferEphemeral: false,
    execute: runTexas
})
