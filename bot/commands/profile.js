const { SlashCommandBuilder, EmbedBuilder, Colors } = require("discord.js")
const playerClass = require("../games/classes.js")
const setSeparator = require("../utils/setSeparator")
const { normalizeUserExperience } = require("../utils/experience")
const createCommand = require("../utils/createCommand")

const slashCommand = new SlashCommandBuilder().setName("profile").setDescription("Show your Chipsy profile.")

module.exports = createCommand({
    name: "profile",
    description: "Show your Chipsy profile.",
    aliases: ["stats"],
    slashCommand,
    deferEphemeral: false,
    errorMessage: "Unable to load your profile right now. Please try again later.",
    execute: async(context) => {
        const { author, reply } = context

        if (!author) {
            context.fail("Unable to resolve your Discord account details.")
        }

        const data = normalizeUserExperience(author.data || {})
        author.data = data

        const avatarURL = author.displayAvatarURL({ extension: "png" })
        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .addFields(
                { name: "Your profile", value: "Here you can see everything about yourself", inline: false },
                {
                    name: "Balance 💰",
                    value: `Money: ${setSeparator(data.money)}$\nGold: ${setSeparator(data.gold)}`,
                    inline: true
                },
                {
                    name: "Experience ⭐",
                    value: `Level: ${setSeparator(data.level)}\nExp: ${setSeparator(data.current_exp)}/${setSeparator(data.required_exp)}`,
                    inline: true
                },
                {
                    name: "Records 🔝",
                    value: `Biggest bet: ${setSeparator(data.biggest_bet)}$\nBiggest won: ${setSeparator(data.biggest_won)}$`,
                    inline: true
                },
                {
                    name: "Other 🃏",
                    value: `Hands played: ${setSeparator(data.hands_played)}\nHands won: ${setSeparator(data.hands_won)}`,
                    inline: true
                },
                {
                    name: "Upgrades ⬆️",
                    value: `WithHolding level: ${data.withholding_upgrade}\nReward amount level: ${data.reward_amount_upgrade}\nReward time level: ${data.reward_time_upgrade}`,
                    inline: true
                },
                { name: "Class 🔰", value: playerClass.getUserClass(data.money), inline: true }
            )
            .setThumbnail(avatarURL)
            .setFooter({ text: `${author.tag} | Last played: ${data.last_played}`, iconURL: avatarURL })

        await reply({ embeds: [embed] })
    }
})
