const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")

const runUpgrade = async(msg) => {
    const dataHandler = msg.client?.dataHandler
    if (!dataHandler) {
        throw new Error("Data handler is not available on the client.")
    }
    const options = ["💛", "💚", "💙", "❌"],
        confirm = ["✅", "❌"],
        info = msg.author.data

    const avatarURL = msg.author.displayAvatarURL({ extension: "png" })
    const buildPanelEmbed = () => new Discord.EmbedBuilder()
        .setColor(Discord.Colors.Aqua)
        .addFields(
            { name: "Upgrade Panel 🔼", value: "Through this panel you will be able to upgrade game features" },
            {
                name: "Upgrade options ⚙️",
                value: `Use ${options[0]} to upgrade with-holding level\nUse ${options[1]} to upgrade daily reward amount level\nUse ${options[2]} to upgrade daily reward time level`
            },
            {
                name: "Features explained 💬",
                value: "**With-holding upgrade:** buying an upgrade will decrease the amount of money subtracted every time you win a considerable amount of money.\nWith-holding is 8 times higher in blackjack game, and each upgrade will have 2.5 times the original effect\n**Daily reward amount:** buying an upgrade will increase the amount of money you can get from the daily reward\n**Daily reward time:** buying an upgrade will decrease the time needed to reedem another daily reward"
            },
            {
                name: "Reward amount upgrade 🏆",
                value: `**Current level:** ${info.reward_amount_upgrade}/${features.get("reward-amount").max} - [+${setSeparator(features.applyUpgrades("reward-amount", info.reward_amount_upgrade))}$]\n**Next level:**  ${info.reward_amount_upgrade < features.get("reward-amount").max ? `${info.reward_amount_upgrade + 1}/${features.get("reward-amount").max} - [+${setSeparator(features.applyUpgrades("reward-amount", info.reward_amount_upgrade + 1))}$]\n**Buy now:** ${features.getCosts("reward-amount")[info.reward_amount_upgrade]}$` : "[MAX]"}`
            },
            {
                name: "Reward time upgrade ⏳",
                value: `**Current level:** ${info.reward_time_upgrade}/${features.get("reward-time").max} - [${features.applyUpgrades("reward-time", info.reward_time_upgrade)}h]\n**Next level:** ${info.reward_time_upgrade < features.get("reward-time").max ? `${info.reward_time_upgrade + 1}/${features.get("reward-time").max} - [${features.applyUpgrades("reward-time", info.reward_time_upgrade + 1)}h]\n**Buy now:** ${features.getCosts("reward-time")[info.reward_time_upgrade]}$` : "[MAX]"}`
            },
            {
                name: "With-holding upgrade 💵",
                value: `**Current level:** ${info.withholding_upgrade}/${features.get("with-holding").max} - [-${features.applyUpgrades("with-holding", info.withholding_upgrade)}%]\n**Next level:** ${info.withholding_upgrade < features.get("with-holding").max ? `${info.withholding_upgrade + 1}/${features.get("with-holding").max} - [-${features.applyUpgrades("with-holding", info.withholding_upgrade + 1)}%]\n**Buy now:** ${features.getCosts("with-holding")[info.withholding_upgrade]}$` : "[MAX]"}`
            }
        )
        .setFooter({ text: `${msg.author.tag} | Available money: ${setSeparator(info.money)}$ | 3 minutes left to choose`, iconURL: avatarURL })
        .setThumbnail(avatarURL)

    const panelMessage = await msg.channel.send({ embeds: [buildPanelEmbed()] })
    for (let option of options)
        await panelMessage.react(option)

    const upgradeFeature = (n) => {
        return (n == 0 ? ++msg.author.data.withholding_upgrade :
                n == 1 ? ++msg.author.data.reward_amount_upgrade :
                n == 2 ? ++msg.author.data.reward_time_upgrade :
                null
            )
    }

    const order = ["with-holding", "reward-amount", "reward-time"]
    let mainCollector
    const showConfirm = async(choice, n) => {
        await panelMessage.reactions.removeAll().catch(() => {})
        if (mainCollector) mainCollector.stop("other")
        const confirmEmbed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Orange)
            .setFooter({ text: `${msg.author.tag}, do you really want to buy this upgrade? Please confirm your choice | 30 seconds left to choose`, iconURL: avatarURL })
        await panelMessage.edit({ embeds: [confirmEmbed] })
        for (const confOpt of confirm)
            await panelMessage.react(confOpt)

        const confirmCollector = panelMessage.createReactionCollector({
            filter: (reaction, user) => confirm.includes(reaction.emoji.name) && user.id == msg.author.id,
            time: 30000
        })

        confirmCollector.on("collect", async(reaction) => {
            let responseEmbed
            switch(reaction.emoji.name) {
                case confirm[0]: {
                    const feature = order[n]
                    const isMaxed = choice >= features.get(feature).max
                    const costList = features.getCosts(feature, true)
                    const cost = costList ? costList[choice] : 0
                    const cannotAfford = cost > msg.author.data.money
                    const errorMessage = isMaxed ? "maximum level reached for this upgrade" : (cannotAfford ? "you can not afford this upgrade" : null)

                    if (errorMessage) {
                        responseEmbed = new Discord.EmbedBuilder()
                            .setColor(Discord.Colors.Red)
                            .setFooter({ text: `${msg.author.tag}, ${errorMessage}`, iconURL: avatarURL })
                        break
                    }
                    msg.author.data.money -= cost
                    await upgradeFeature(n)
                    await dataHandler.updateUserData(msg.author.id, dataHandler.resolveDBUser(msg.author))
                    responseEmbed = new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Green)
                        .setFooter({ text: `${msg.author.tag}, upgrade applied, congrats!`, iconURL: avatarURL })
                    break
                }
                case confirm[1]:
                    responseEmbed = new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setFooter({ text: `${msg.author.tag}, operation aborted!`, iconURL: avatarURL })
                break
            }
            if (responseEmbed) {
                await panelMessage.edit({ embeds: [responseEmbed] })
            }
            await reaction.users.remove(msg.author).catch(() => {})
            await panelMessage.reactions.removeAll().catch(() => {})
            confirmCollector.stop("other")
        })

        confirmCollector.on("end", (_, reason) => {
            if (panelMessage.deletable && reason != "other") panelMessage.delete()
        })
    }

    mainCollector = panelMessage.createReactionCollector({
        filter: (reaction, user) => options.includes(reaction.emoji.name) && user.id == msg.author.id,
        time: 180000
    })

    mainCollector.on("collect", (reaction) => {
        switch(reaction.emoji.name) {
            case options[0]:
                if (info.withholding_upgrade < features.get("with-holding").max)
                    showConfirm(msg.author.data.withholding_upgrade, 0)
            break
            case options[1]:
                if (info.reward_amount_upgrade < features.get("reward-amount").max)
                    showConfirm(msg.author.data.reward_amount_upgrade, 1)
            break
            case options[2]:
                if (info.reward_time_upgrade < features.get("reward-time").max)
                    showConfirm(msg.author.data.reward_time_upgrade, 2)
            break
            case options[3]:
                mainCollector.stop()
            break
        }
        reaction.users.remove(msg.author).catch(() => {})
    })

    mainCollector.on("end", (_, reason) => {
        if (panelMessage.deletable && reason != "other") panelMessage.delete()
    })
}

const slashCommand = new SlashCommandBuilder()
    .setName("upgrade")
    .setDescription("Open the Chipsy upgrade panel.")

module.exports = {
    config: {
        name: "upgrade",
        aliases: ["upgrades"],
        description: "Open the Chipsy upgrade panel.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runUpgrade(message)
    }
}
