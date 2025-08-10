const { SlashCommandBuilder } = require("discord.js")

const run = async(msg) => {
    const iconURL = msg.author.displayAvatarURL({ extension: "png" })
    const loadingEmbed = new Discord.EmbedBuilder()
        .setColor(Math.floor(Math.random() * 0xffffff))
        .setFooter({ text: "Ping?!" })

    const sentMessage = await msg.channel.send({ embeds: [loadingEmbed] })
    const latency = (sentMessage.createdTimestamp - msg.createdTimestamp).toFixed()
    const pongEmbed = new Discord.EmbedBuilder()
        .setColor(loadingEmbed.data.color ?? Math.floor(Math.random() * 0xffffff))
        .setFooter({
            text: `${msg.author.tag} | Pong!! (${latency}ms) | Websocket: ${msg.client.ws.ping.toFixed()}ms`,
            iconURL
        })

    await sentMessage.edit({ embeds: [pongEmbed] })
}

module.exports = {
    name: "ping",
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Show the bot latency."),
    dmPermission: false,
    async execute({ message }) {
        await run(message)
    }
}