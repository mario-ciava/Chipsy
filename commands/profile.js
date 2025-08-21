const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const playerClass = require("../structure/classes.js")
const setSeparator = require("../util/setSeparator")
const { normalizeUserExperience } = require("../util/experience")
const logger = require("../util/logger")

const runProfile = async (msg) => {
    try {
        const data = normalizeUserExperience(msg.author.data || {})
        msg.author.data = data

        const avatarURL = msg.author.displayAvatarURL({ extension: "png" })
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Gold)
            .addFields(
                { name: "Your profile", value: "Here you can see everything about yourself", inline: false },
                {
                    name: "Balance 💰",
                    value: `Money: ${setSeparator(msg.author.data.money)}$\nGold: ${setSeparator(msg.author.data.gold)}`,
                    inline: true
                },
                {
                    name: "Experience ⭐",
                    value: `Level: ${setSeparator(msg.author.data.level)}\nExp: ${setSeparator(msg.author.data.current_exp)}/${setSeparator(msg.author.data.required_exp)}`,
                    inline: true
                },
                {
                    name: "Records 🔝",
                    value: `Biggest bet: ${setSeparator(msg.author.data.biggest_bet)}$\nBiggest won: ${setSeparator(msg.author.data.biggest_won)}$`,
                    inline: true
                },
                {
                    name: "Other 🃏",
                    value: `Hands played: ${setSeparator(msg.author.data.hands_played)}\nHands won: ${setSeparator(msg.author.data.hands_won)}`,
                    inline: true
                },
                {
                    name: "Upgrades ⬆️",
                    value: `WithHolding level: ${msg.author.data.withholding_upgrade}\nReward amount level: ${msg.author.data.reward_amount_upgrade}\nReward time level: ${msg.author.data.reward_time_upgrade}`,
                    inline: true
                },
                { name: "Class 🔰", value: `${playerClass.getUserClass(msg.author.data.money)}`, inline: true }
            )
            .setThumbnail(avatarURL)
            .setFooter({ text: `${msg.author.tag} | Last played: ${msg.author.data.last_played}`, iconURL: avatarURL })

        await msg.channel.send({ embeds: [embed] }).catch((error) => {
            logger.error("Failed to send profile embed", {
                scope: "commands",
                command: "profile",
                userId: msg.author.id,
                channelId: msg.channel.id,
                error: error.message,
                stack: error.stack
            })
            throw error
        })
    } catch (error) {
        logger.error("Failed to execute profile command", {
            scope: "commands",
            command: "profile",
            userId: msg.author.id,
            error: error.message,
            stack: error.stack
        })

        try {
            await msg.channel.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setDescription("❌ An error occurred while loading your profile. Please try again later.")
                ]
            })
        } catch (sendError) {
            logger.error("Failed to send error message", {
                scope: "commands",
                command: "profile",
                error: sendError.message
            })
        }
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show your Chipsy profile.")

module.exports = {
    config: {
        name: "profile",
        aliases: ["stats"],
        description: "Show your Chipsy profile.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runProfile(message)
    }
}
