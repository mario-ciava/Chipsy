var Texas = require("../structure/texas.js"),
    features = require("../structure/features.js")
const delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})}
exports.run = (msg) => {
    if (msg.channel.game) return msg.channel.send(
        new Discord.RichEmbed()
            .setColor("RED")
            .setFooter(`${msg.author.tag}, access denied: a game is already existing in this channel`, msg.author.avatarURL)
    )
    msg.params[0] = features.inputConverter(msg.params[0])
    msg.params[1] = features.inputConverter(msg.params[1])
    if (msg.params[1] > 9 || msg.params[1] < 2) return msg.channel.send(
        new Discord.RichEmbed()
            .setColor("RED")
            .setFooter(`${msg.author.tag}, access denied: maximum number of players must be between 2 and 9`, msg.author.avatarURL)
    )
    msg.channel.game = new Texas({
        message: msg,
        minBet: msg.params[0],
        maxPlayers: msg.params[1] || 9
    })
    msg.channel.send(
        new Discord.RichEmbed()
            .setColor("GREEN")
            .addField("Texas holdem poker ❤", "Your game has been created", false)
            .addField("Players [0] 🤑", `-`, true)
            .addField("Other info 💰", `Min buy-in: ${setSeparator(msg.channel.game.minBuyIn)}$\nMax buy-in: ${setSeparator(msg.channel.game.maxBuyIn)}$\nMinimum bet: ${setSeparator(msg.channel.game.minBet)}$`, true)
            .addField("Options ⚙", "Type **join [buy-in-amount]** to join this game any moment\nType **leave** to leave this game any moment", false)
            .addField("Be aware ⚠", "If you leave the game while playing, you will lose your bet on the table\nIf all the players leave, the game will be stopped")
            .setFooter("45 Seconds left")
    ).then(async(m) => {
        msg.channel.collector = msg.channel.createMessageCollector((mess) => {
            return !mess.author.bot && (mess.content.toLowerCase().startsWith("join") || mess.content.toLowerCase() == "leave")
        })
        msg.channel.collector.on("collect", async(mess) => {
            if (!mess.author.data) await app.SetData(mess.author)
            if (!mess.author.data) return
            let cont = mess.content.toLowerCase().split(" ")
            let action = cont[0]
                value = features.inputConverter(cont[1])
            if (action == "join") {
                if (mess.author.data.money < msg.channel.game.minBuyIn || (!isNaN(value) && mess.author.data.money < value)) return msg.channel.send(
                    new Discord.RichEmbed()
                        .setColor("RED")
                        .setFooter(`${mess.author.tag}, access denied: your money must be at least equal or higher than the minimum buy-in`, mess.author.avatarURL)
                )
                if (!value) value = msg.channel.game.minBuyIn
                if (value < msg.channel.game.minBuyIn || value > msg.channel.game.maxBuyIn) return msg.channel.send(
                    new Discord.RichEmbed()
                        .setColor("RED")
                        .setFooter(`${mess.author.tag}, access denied: your buy-in is not in the allowed range for this game`)
                )
                mess.author.stack = value
                await msg.channel.game.AddPlayer(mess.author)
            } else await msg.channel.game.RemovePlayer(mess.author)
            m.embeds[0].fields[1].name = `Players [${msg.channel.game.players.length}] 🤑`
            m.embeds[0].fields[1].value = `${msg.channel.game.players.join(", ") || "-"}`
            m.edit(new Discord.RichEmbed(m.embeds[0]))
            if (mess.deletable) mess.delete()
        })
        await delay(45000)
        if (msg.channel.game.playing) return
        if (msg.channel.game.players.length > 1) msg.channel.game.Run(true)
            else msg.channel.game.Stop()
    })
}

exports.config = {
    "name": "texas",
    "params": ["minBet"]
}

//play <minBet> [maxPlayers]