exports.run = (msg) => {
    msg.channel.send(
        new Discord.RichEmbed().setColor("RANDOM")
            .setFooter("Ping?!")
    ).then((m) => {
        m.embeds[0].footer.text = null
        m.edit(
            new Discord.RichEmbed(m.embeds[0])
                .setFooter(`${msg.author.tag} | Pong!! (${(m.createdTimestamp - msg.createdTimestamp).toFixed()}ms) | Websocket: ${msg.client.ping.toFixed()}ms`, msg.author.avatarURL)
        )
    })
}

exports.config = {
    "name": "ping",
    "params": []
}