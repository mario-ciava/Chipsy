const features = require("../structure/features.js")
exports.run = async(msg) => {
    let rewardDate = msg.author.data.next_reward ? new Date(msg.author.data.next_reward) : new Date()
    if (new Date().getTime() < rewardDate.getTime()) return msg.channel.send(
        new Discord.RichEmbed().setColor("RED")
            .addField("Too soon!", `${msg.author}, you can not redeem your reward yet, please come back later.`)
            .setFooter(`Next reward: ${rewardDate.toString()}`, msg.author.displayAvatarURL)
        )
    let amount = await features.applyUpgrades("reward-amount", msg.author.data.reward_amount_upgrade)
    msg.author.data.money += amount
    msg.author.data.next_reward = new Date(new Date().getTime() + (features.applyUpgrades("reward-time", msg.author.data.reward_time_upgrade) * 60 * 60 * 1000))
    await DR.updateUserData(msg.author.id, DR.resolveDBUser(msg.author))
    msg.channel.send(
        new Discord.RichEmbed().setColor("GREEN")
            .setFooter(`${msg.author.tag}, you have been awarded ${setSeparator(amount)}$`, msg.author.displayAvatarURL)
    )
}

exports.config = {
    "name": "reward",
    "params": []
}