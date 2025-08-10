const { SlashCommandBuilder } = require("discord.js")
const playerClass = require("../structure/classes.js")

const setSeparator = (number) => {
    if (isNaN(number)) return null
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}

const run = (msg) => {
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

    msg.channel.send({ embeds: [embed] })
}

module.exports = {
    name: "profile",
    data: new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Show your Chipsy profile."),
    dmPermission: false,
    async execute({ message }) {
        run(message)
    }
}
