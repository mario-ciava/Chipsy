const { SlashCommandBuilder } = require("discord.js")

const run = (msg) => {
    const game = (msg.params[0] || "").toLowerCase()

    if (game !== "blackjack") {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setDescription("Please specify a supported game. Available options: blackjack.")
        return msg.channel.send({ embeds: [embed] })
    }

    msg.channel.send({
        embeds: [
            new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Blue)
                .addFields({
                    name: "Blackjack rules",
                    value: `Dealer must stand on: 17 or higher\nInsurance pays: 2:1\nBlackjack pays: 3:2\nWithholding (default): 0.0024%\nNumber of decks: 3\nReshuffling: 25 cards or less\nDouble: any\nDouble after split: no\nHit after splitting aces: no`
                })
                .setThumbnail(msg.client.user.displayAvatarURL({ extension: "png" }))
        ]
    })
}

module.exports = {
    name: "rules",
    data: new SlashCommandBuilder()
        .setName("rules")
        .setDescription("Show the rules for a supported game.")
        .addStringOption((option) =>
            option
                .setName("game")
                .setDescription("Select the game to display rules for.")
                .setRequired(true)
                .addChoices({ name: "Blackjack", value: "blackjack" })
        ),
    dmPermission: false,
    async execute({ message }) {
        run(message)
    }
}
