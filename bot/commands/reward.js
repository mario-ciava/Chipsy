const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags } = require("discord.js")
const features = require("../games/features.js")
const setSeparator = require("../utils/setSeparator")
const createCommand = require("../utils/createCommand")

const slashCommand = new SlashCommandBuilder().setName("reward").setDescription("Redeem your periodic reward.")

module.exports = createCommand({
    name: "reward",
    description: "Redeem your periodic reward.",
    aliases: ["daily"],
    slashCommand,
    deferEphemeral: false,
    errorMessage: "We could not process your reward. Please try again later.",
    execute: async(interaction, client) => {
        const respond = async(payload = {}) => {
            if (interaction.deferred && !interaction.replied) {
                return interaction.editReply(payload)
            }
            if (!interaction.replied) {
                return interaction.reply(payload)
            }
            return interaction.followUp(payload)
        }

        const author = interaction.user

        if (!author) {
            await respond({
                content: "❌ Unable to resolve your Discord account details.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const profile = author.data
        if (!profile) {
            await respond({
                content: "❌ Your profile is still loading. Please try again in a moment.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const now = Date.now()
        const rewardDate = profile.next_reward ? new Date(profile.next_reward) : null

        if (rewardDate && now < rewardDate.getTime()) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .addFields({
                    name: "Too soon!",
                    value: `${author}, you cannot redeem your reward yet. Please come back later.`
                })
                .setFooter({
                    text: `Next reward: ${rewardDate.toString()}`,
                    iconURL: author.displayAvatarURL({ extension: "png" })
                })

            await respond({ embeds: [embed] })
            return
        }

        const dataHandler = client?.dataHandler ?? interaction.client?.dataHandler
        if (!dataHandler) {
            throw new Error("Data handler is not available on the client.")
        }

        const amount = await features.applyUpgrades("reward-amount", profile.reward_amount_upgrade)
        profile.money += amount

        const cooldownHours = await features.applyUpgrades("reward-time", profile.reward_time_upgrade)
        const cooldownMs = Math.max(60 * 60 * 1000, Math.floor(cooldownHours * 60 * 60 * 1000))
        profile.next_reward = new Date(now + cooldownMs)

        await dataHandler.updateUserData(author.id, dataHandler.resolveDBUser(author))

        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setFooter({
                text: `${author.tag}, you have been awarded ${setSeparator(amount)}$`,
                iconURL: author.displayAvatarURL({ extension: "png" })
            })

        await respond({ embeds: [embed] })
    }
})
