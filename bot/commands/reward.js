const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags } = require("discord.js")
const features = require("../../shared/features")
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
        const cooldownHours = await features.applyUpgrades("reward-time", profile.reward_time_upgrade)
        const cooldownMs = Math.max(60 * 60 * 1000, Math.floor(cooldownHours * 60 * 60 * 1000))

        let redemption = null
        if (typeof dataHandler.redeemReward === "function") {
            redemption = await dataHandler.redeemReward(author.id, {
                amount,
                cooldownMs,
                now: new Date(now)
            })
        } else {
            const nextRewardDate = new Date(now + cooldownMs)
            profile.money = (profile.money || 0) + amount
            profile.next_reward = nextRewardDate

            const payload = typeof dataHandler.resolveDBUser === "function"
                ? dataHandler.resolveDBUser(author)
                : { money: profile.money, gold: profile.gold }

            await dataHandler.updateUserData(author.id, {
                money: payload.money,
                gold: payload.gold
            })

            redemption = {
                ok: true,
                data: {
                    ...profile
                }
            }
        }

        if (!redemption) {
            throw new Error("Reward redemption service unavailable.")
        }

        if (!redemption.ok) {
            if (redemption.reason === "cooldown") {
                const nextAvailable = redemption.nextReward || rewardDate
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .addFields({
                        name: "Too soon!",
                        value: `${author}, you cannot redeem your reward yet. Please come back later.`
                    })
                    .setFooter({
                        text: nextAvailable ? `Next reward: ${nextAvailable.toString()}` : undefined,
                        iconURL: author.displayAvatarURL({ extension: "png" })
                    })
                await respond({ embeds: [embed] })
                return
            }

            await respond({
                content: "❌ Unable to process your reward right now. Please try again later.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        if (redemption.data) {
            author.data = redemption.data
        }

        const embed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setFooter({
                text: `${author.tag}, you have been awarded ${setSeparator(amount)}$`,
                iconURL: author.displayAvatarURL({ extension: "png" })
            })

        await respond({ embeds: [embed] })
    }
})
