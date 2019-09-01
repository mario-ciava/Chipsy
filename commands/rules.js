exports.run = (msg) => {
    switch(msg.params[0]) {
        case "blackjack":
            msg.channel.send(
                new Discord.RichEmbed()
                    .setColor("BLUE")
                    .addField("Blackjack rules", `Dealer must stand on: 17 or higher\nInsurance pays: 2:1\nBlackjack pays: 3:2\nWithholding (default): 0.0024%\nNumber of decks: 3\nReshuffling: 25 cards or less\nDouble: any\nDouble after split: no\nHit after splitting aces: no`)
                    .setThumbnail(msg.client.displayAvatarURL)
            )
        break
    }
}

exports.config = {
    "name": "rules",
    "params": ["game"]
}