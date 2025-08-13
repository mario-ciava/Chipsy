const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")

const runReward = async(msg) => {
    const rewardDate = msg.author.data.next_reward ? new Date(msg.author.data.next_reward) : new Date()
    if (new Date().getTime() < rewardDate.getTime()) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .addFields({ name: "Too soon!", value: `${msg.author}, you can not redeem your reward yet, please come back later.` })
            .setFooter({ text: `Next reward: ${rewardDate.toString()}`, iconURL: msg.author.displayAvatarURL({ extension: "png" }) })
        return msg.channel.send({ embeds: [embed] })
    }
    const dataHandler = msg.client?.dataHandler
    if (!dataHandler) {
        throw new Error("Data handler is not available on the client.")
    }

    const amount = await features.applyUpgrades("reward-amount", msg.author.data.reward_amount_upgrade)
    msg.author.data.money += amount
    msg.author.data.next_reward = new Date(new Date().getTime() + (features.applyUpgrades("reward-time", msg.author.data.reward_time_upgrade) * 60 * 60 * 1000))
    await dataHandler.updateUserData(msg.author.id, dataHandler.resolveDBUser(msg.author))
    const embed = new Discord.EmbedBuilder()
        .setColor(Discord.Colors.Green)
        .setFooter({
            text: `${msg.author.tag}, you have been awarded ${setSeparator(amount)}$`,
            iconURL: msg.author.displayAvatarURL({ extension: "png" })
        })
    msg.channel.send({ embeds: [embed] })
}

const slashCommand = new SlashCommandBuilder()
    .setName("reward")
    .setDescription("Redeem your periodic reward.")

module.exports = {
    config: {
        name: "reward",
        aliases: ["daily"],
        description: "Redeem your periodic reward.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runReward(message)
    }
}
