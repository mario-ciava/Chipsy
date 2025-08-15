const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const Texas = require("../structure/texas.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")
const delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})}
const runTexas = async(msg) => {
    if (!Array.isArray(msg.params)) msg.params = []

    if (!msg.params[0]) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setFooter({
                text: `${msg.author.tag}, access denied: you must specify the minimum bet amount.`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })
        return msg.channel.send({ embeds: [embed] })
    }
    if (msg.channel.game) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setFooter({
                text: `${msg.author.tag}, access denied: a game is already existing in this channel`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })
        return msg.channel.send({ embeds: [embed] })
    }
    msg.params[0] = features.inputConverter(msg.params[0])
    msg.params[1] = features.inputConverter(msg.params[1])
    if (msg.params[1] > 9 || msg.params[1] < 2) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setFooter({
                text: `${msg.author.tag}, access denied: maximum number of players must be between 2 and 9`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })
        return msg.channel.send({ embeds: [embed] })
    }
    msg.channel.game = new Texas({
        message: msg,
        minBet: msg.params[0],
        maxPlayers: msg.params[1] || 9
    })
    const buildGameEmbed = () => {
        const players = msg.channel.game?.players || []
        return new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .addFields(
                { name: "Texas holdem poker ❤", value: "Your game has been created", inline: false },
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
    const statusMessage = await msg.channel.send({ embeds: [buildGameEmbed()] })
    msg.channel.collector = msg.channel.createMessageCollector({
        filter: (mess) => {
            return !mess.author.bot && (mess.content.toLowerCase().startsWith("join") || mess.content.toLowerCase() == "leave")
        }
    })
    msg.channel.collector.on("collect", async(mess) => {
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
                return msg.channel.send({ embeds: [embed] })
            }
            if (!value) value = msg.channel.game.minBuyIn
            if (value < msg.channel.game.minBuyIn || value > msg.channel.game.maxBuyIn) {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${mess.author.tag}, access denied: your buy-in is not in the allowed range for this game`
                    })
                return msg.channel.send({ embeds: [embed] })
            }
            mess.author.stack = value
            await msg.channel.game.AddPlayer(mess.author)
        } else await msg.channel.game.RemovePlayer(mess.author)
        await statusMessage.edit({ embeds: [buildGameEmbed()] })
        if (mess.deletable) mess.delete()
    })
    await delay(45000)
    if (msg.channel.game.playing) return
    if (msg.channel.game.players.length > 1) msg.channel.game.Run(true)
        else msg.channel.game.Stop()
}

const slashCommand = new SlashCommandBuilder()
    .setName("texas")
    .setDescription("Start a texas hold'em poker game in the current channel.")
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

module.exports = {
    config: {
        name: "texas",
        aliases: ["holdem"],
        description: "Start a texas hold'em poker game in the current channel.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runTexas(message)
    }
}

//play <minBet> [maxPlayers]
