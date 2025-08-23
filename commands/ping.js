const { SlashCommandBuilder, EmbedBuilder } = require("discord.js")
const createCommand = require("../util/createCommand")

const slashCommand = new SlashCommandBuilder().setName("ping").setDescription("Show the bot latency.")

module.exports = createCommand({
    name: "ping",
    description: "Show the bot latency.",
    slashCommand,
    defer: false,
    errorMessage: "Unable to measure latency right now. Please try again later.",
    execute: async(context) => {
        const { interaction, message, author, client, reply, editReply } = context
        const color = Math.floor(Math.random() * 0xffffff)
        const avatarURL = author?.displayAvatarURL?.({ extension: "png" })
        const loadingEmbed = new EmbedBuilder().setColor(color).setFooter({ text: "Ping?!" })

        const baseTimestamp = interaction?.createdTimestamp ?? message?.createdTimestamp ?? Date.now()
        const wsPing = Math.round(client?.ws?.ping ?? 0)

        if (interaction) {
            const sent = await reply({
                embeds: [loadingEmbed],
                fetchReply: true
            })

            const latency = (sent.createdTimestamp - baseTimestamp).toFixed()
            const responseEmbed = new EmbedBuilder()
                .setColor(color)
                .setFooter({
                    text: `${author?.tag ?? "Unknown user"} | Pong!! (${latency}ms) | Websocket: ${wsPing}ms`,
                    iconURL: avatarURL
                })

            await editReply({ embeds: [responseEmbed] })
            return
        }

        const initialMessage = await reply({ embeds: [loadingEmbed] })
        const latency = (initialMessage.createdTimestamp - baseTimestamp).toFixed()
        const responseEmbed = new EmbedBuilder()
            .setColor(color)
            .setFooter({
                text: `${author?.tag ?? "Unknown user"} | Pong!! (${latency}ms) | Websocket: ${wsPing}ms`,
                iconURL: avatarURL
            })

        await initialMessage.edit({ embeds: [responseEmbed] })
    }
})
