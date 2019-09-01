const features = require("../structure/features.js")
exports.run = (msg) => {
    let options = ["💛", "💚", "💙", "❌"],
        confirm = ["✅", "❌"]
        info = msg.author.data

    msg.channel.send(
        new Discord.RichEmbed()
            .setColor("AQUA")
            .addField("Upgrade Panel 🔼", "Through this panel you will be able to upgrade game features")
            .addField("Upgrade options ⚙️", `Use ${options[0]} to upgrade with-holding level\nUse ${options[1]} to upgrade daily reward amount level\nUse ${options[2]} to upgrade daily reward time level`)
            .addField("Features explained 💬", "**With-holding upgrade:** buying an upgrade will decrease the amount of money subtracted every time you win a considerable amount of money.\nWith-holding is 8 times higher in blackjack game, and each upgrade will have 2.5 times the original effect\n**Daily reward amount:** buying an upgrade will increase the amount of money you can get from the daily reward\n**Daily reward time:** buying an upgrade will decrease the time needed to reedem another daily reward")
            .addField("Reward amount upgrade 🏆", `**Current level:** ${info.reward_amount_upgrade}/${features.get("reward-amount").max} - [+${setSeparator(features.applyUpgrades("reward-amount", info.reward_amount_upgrade))}$]\n**Next level:**  ${info.reward_amount_upgrade < features.get("reward-amount").max ? `${info.reward_amount_upgrade + 1}/${features.get("reward-amount").max} - [+${setSeparator(features.applyUpgrades("reward-amount", info.reward_amount_upgrade + 1))}$]\n**Buy now:** ${features.getCosts("reward-amount")[info.reward_amount_upgrade]}$` : "[MAX]"}`, true)
            .addField("Reward time upgrade ⏳", `**Current level:** ${info.reward_time_upgrade}/${features.get("reward-time").max} - [${features.applyUpgrades("reward-time", info.reward_time_upgrade)}h]\n**Next level:** ${info.reward_time_upgrade < features.get("reward-time").max ? `${info.reward_time_upgrade + 1}/${features.get("reward-time").max} - [${features.applyUpgrades("reward-time", info.reward_time_upgrade + 1)}h]\n**Buy now:** ${features.getCosts("reward-time")[info.reward_time_upgrade]}$` : "[MAX]"}`, true)
            .addField("With-holding upgrade 💵", `**Current level:** ${info.withholding_upgrade}/${features.get("with-holding").max} - [-${features.applyUpgrades("with-holding", info.withholding_upgrade)}%]\n**Next level:** ${info.withholding_upgrade < features.get("with-holding").max ? `${info.withholding_upgrade + 1}/${features.get("with-holding").max} - [-${features.applyUpgrades("with-holding", info.withholding_upgrade + 1)}%]\n**Buy now:** ${features.getCosts("with-holding")[info.withholding_upgrade]}$` : "[MAX]"}`)
            .setFooter(`${msg.author.tag} | Available money: ${setSeparator(info.money)}$ | 3 minutes left to choose`, msg.author.displayAvatarURL)
            .setThumbnail(msg.author.displayAvatarURL)    
    ).then(async(m) => {

        for (let option of options)
            await m.react(option)

        var upgradeFeature = (n) => {
            return (n == 0 ? ++msg.author.data.withholding_upgrade :
                    n == 1 ? ++msg.author.data.reward_amount_upgrade :
                    n == 2 ? ++msg.author.data.reward_time_upgrade :
                    null
                )
        }

        var showConfirm = async(message, collector, choice, n) => {
            await message.clearReactions()
            message.embeds[0].fields = []
            message.embeds[0].footer.text = null
            message.embeds[0].thumbnail = null
            collector.stop("other")
            message.edit(
                new Discord.RichEmbed(message.embeds[0])
                    .setColor("ORANGE")
                    .setFooter(`${msg.author.tag}, do you really want to buy this upgrade? Please confirm your choice | 30 seconds left to choose`, msg.author.displayAvatarURL)
            ).then(async(mess) => {
                for (let confOpt of confirm)
                    await mess.react(confOpt)

                let coll = await mess.createReactionCollector((reaction, user) => confirm.includes(reaction.emoji.name) && user.id == msg.author.id, {
                    time: 30000
                })
                coll.on("collect", async(reaction) => {
                    mess.embeds[0].fields = []
                    mess.embeds[0].footer.text = null
                    let order = ["with-holding", "reward-amount", "reward-time"]
                    switch(reaction.emoji.name) {
                        case `${confirm[0]}`:
                            let errorMessage = choice >= features.get(order[n]).max ? "maximum level reached for this upgrade" :
                                (features.getCosts(order[n], true)[choice] > msg.author.data.money ? "you can not afford this upgrade" :
                                null)

                            if (errorMessage) {
                                mess.edit(
                                    new Discord.RichEmbed(mess.embeds)
                                        .setColor("RED")
                                        .setFooter(`${msg.author.tag}, ${errorMessage}`, msg.author.displayAvatarURL)
                                )
                                break 
                            }
                            msg.author.data.money -= features.getCosts(order[n], true)[choice]
                            await upgradeFeature(n)
                            await DR.updateUserData(msg.author.id, DR.resolveDBUser(msg.author))
                            mess.edit(
                                new Discord.RichEmbed(mess.embeds[0])
                                    .setColor("GREEN")
                                    .setFooter(`${msg.author.tag}, upgrade applied, congrats!`, msg.author.displayAvatarURL)
                            )
                        break
                        case `${confirm[1]}`:
                            mess.edit(
                                new Discord.RichEmbed(mess.embeds[0])
                                    .setColor("RED")
                                    .setFooter(`${msg.author.tag}, operation aborted!`, msg.author.displayAvatarURL)
                            )
                        break
                    }
                    await mess.clearReactions()
                    coll.stop("other")
                })

                coll.on("end", (coll, reason) => {
                    if (mess.deletable && reason != "other") mess.delete()
                })
            })
        } 

        let coll = await m.createReactionCollector((reaction, user) => options.includes(reaction.emoji.name) && user.id == msg.author.id, {
            time: 180000
        })
        
        coll.on("collect", (reaction) => {
            switch(reaction.emoji.name) {
                case `${options[0]}`:
                    if (info.withholding_upgrade >= features.get("with-holding").max) break
                    showConfirm(m, coll, msg.author.data.withholding_upgrade, 0)
                break
                case `${options[1]}`:
                    if (info.reward_amount_upgrade >= features.get("reward-amount").max) break
                    showConfirm(m, coll, msg.author.data.reward_amount_upgrade, 1)
                break
                case `${options[2]}`:
                    if (info.reward_time_upgrade >= features.get("reward-time").max) break
                    showConfirm(m, coll, msg.author.data.reward_time_upgrade, 2)
                break
                case `${options[3]}`:
                    coll.stop()
                break
            }
            reaction.remove(msg.author)
        })
        coll.on("end", (coll, reason) => {
            if (m.deletable && reason != "other") m.delete()
        })
    })
}

exports.config = {
    "name": "upgrade",
    "params": []
}