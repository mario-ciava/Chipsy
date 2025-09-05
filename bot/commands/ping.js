const { SlashCommandBuilder, EmbedBuilder } = require("discord.js")
const createCommand = require("../utils/createCommand")

const slashCommand = new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Show the bot latency.")

module.exports = createCommand({
    name: "ping",
    description: "Show the bot latency.",
    slashCommand,
    defer: false,
    errorMessage: "Unable to measure latency right now. Please try again later.",
    execute: async (interaction, client) => {
        const author = interaction.user
        const color = Math.floor(Math.random() * 0xffffff)
        const avatarURL = author?.displayAvatarURL?.({ extension: "png" })
        const loadingEmbed = new EmbedBuilder().setColor(color).setFooter({ text: "Ping?!" })

        const baseTimestamp = interaction.createdTimestamp ?? Date.now()
        const wsPing = Math.round(client?.ws?.ping ?? interaction.client?.ws?.ping ?? 0)

        await interaction.reply({ embeds: [loadingEmbed] })
        const sentMessage = await interaction.fetchReply()

        const latency = (sentMessage.createdTimestamp - baseTimestamp).toFixed()
        const responseEmbed = new EmbedBuilder()
            .setColor(color)
            .setFooter({
                text: `🏓 Pong: ${latency}ms | WebSocket: ${wsPing}ms`,
                iconURL: avatarURL
            })

        await interaction.editReply({ embeds: [responseEmbed] })
    }
})