var playerClass = require("../structure/classes.js"),
    setSeparator = (number) => {
    if (isNaN(number)) return null
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}
exports.run = (msg) => {
    msg.channel.send(
        new Discord.RichEmbed().setColor("GOLD")
            .addField("Your profile", `Here you can see everything about yourself`, false)
            .addField("Balance 💰", `Money: ${setSeparator(msg.author.data.money)}$\nGold: ${setSeparator(msg.author.data.gold)}`, true)
            .addField("Experience ⭐", `Level: ${setSeparator(msg.author.data.level)}\nExp: ${setSeparator(msg.author.data.current_exp)}/${setSeparator(msg.author.data.required_exp)}`, true)
            .addField("Records 🔝", `Biggest bet: ${setSeparator(msg.author.data.biggest_bet)}$\nBiggest won: ${setSeparator(msg.author.data.biggest_won)}$`, true)
            .addField("Other 🃏", `Hands played: ${setSeparator(msg.author.data.hands_played)}\nHands won: ${setSeparator(msg.author.data.hands_won)}`, true)
            .addField("Upgrades ⬆️", `WithHolding level: ${msg.author.data.withholding_upgrade}\nReward amount level: ${msg.author.data.reward_amount_upgrade}\nReward time level: ${msg.author.data.reward_time_upgrade}`, true)
            .addField("Class 🔰", `${playerClass.getUserClass(msg.author.data.money)}`, true)
            .setThumbnail(msg.author.displayAvatarURL)
            .setFooter(`${msg.author.tag} | Last played: ${msg.author.data.last_played}`, msg.author.displayAvatarURL)
    )
}

exports.config = {
    "name": "profile",
    "params": []
}