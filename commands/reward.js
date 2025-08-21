const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const features = require("../structure/features.js")
const setSeparator = require("../util/setSeparator")
const logger = require("../util/logger")

const runReward = async(msg) => {
    try {
        const rewardDate = msg.author.data.next_reward ? new Date(msg.author.data.next_reward) : new Date()
        if (new Date().getTime() < rewardDate.getTime()) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .addFields({ name: "Too soon!", value: `${msg.author}, you can not redeem your reward yet, please come back later.` })
                .setFooter({ text: `Next reward: ${rewardDate.toString()}`, iconURL: msg.author.displayAvatarURL({ extension: "png" }) })
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send reward cooldown message", {
                    scope: "commands",
                    command: "reward",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }
        const dataHandler = msg.client?.dataHandler
        if (!dataHandler) {
            throw new Error("Data handler is not available on the client.")
        }

        const amount = await features.applyUpgrades("reward-amount", msg.author.data.reward_amount_upgrade)
        msg.author.data.money += amount
        const cooldownHours = await features.applyUpgrades("reward-time", msg.author.data.reward_time_upgrade)
        const cooldownMs = Math.max(60 * 60 * 1000, Math.floor(cooldownHours * 60 * 60 * 1000))
        msg.author.data.next_reward = new Date(Date.now() + cooldownMs)

        await dataHandler.updateUserData(msg.author.id, dataHandler.resolveDBUser(msg.author)).catch((error) => {
            logger.error("Failed to update user data for reward", {
                scope: "commands",
                command: "reward",
                userId: msg.author.id,
                error: error.message,
                stack: error.stack
            })
            throw error
        })

        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .setFooter({
                text: `${msg.author.tag}, you have been awarded ${setSeparator(amount)}$`,
                iconURL: msg.author.displayAvatarURL({ extension: "png" })
            })

        await msg.channel.send({ embeds: [embed] }).catch((error) => {
            logger.error("Failed to send reward success message", {
                scope: "commands",
                command: "reward",
                userId: msg.author.id,
                channelId: msg.channel.id,
                error: error.message,
                stack: error.stack
            })
            throw error
        })
    } catch (error) {
        logger.error("Failed to execute reward command", {
            scope: "commands",
            command: "reward",
            userId: msg.author.id,
            error: error.message,
            stack: error.stack
        })

        try {
            await msg.channel.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setDescription("❌ An error occurred while processing your reward. Please try again later.")
                ]
            })
        } catch (sendError) {
            logger.error("Failed to send error message", {
                scope: "commands",
                command: "reward",
                error: sendError.message
            })
        }
    }
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
