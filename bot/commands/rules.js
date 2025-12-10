const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags } = require("discord.js")
const createCommand = require("../utils/createCommand")

const slashCommand = new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Show the rules for a supported game.")
    .addStringOption((option) =>
        option
            .setName("game")
            .setDescription("Select the game to display rules for.")
            .setRequired(true)
            .addChoices({ name: "Blackjack", value: "blackjack" })
    )

module.exports = createCommand({
    name: "rules",
    description: "Show the rules for a supported game.",
    aliases: ["rule"],
    slashCommand,
    deferEphemeral: false,
    errorMessage: "Unable to load the game rules right now. Please try again later.",
    execute: async(interaction, client) => {
        const game = interaction.options.getString("game", true).toLowerCase()

        if (game !== "blackjack") {
            await interaction.reply({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Please specify a supported game. Available: blackjack")],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .addFields({
                name: "Blackjack rules",
                value: [
                    "Dealer must stand on: 17 or higher",
                    "Insurance pays: 2:1",
                    "Blackjack pays: 3:2",
                    "Withholding (default): 0.0024%",
                    "Number of decks: 3",
                    "Reshuffling: 25 cards or less",
                    "Double: any",
                    "Double after split: no",
                    "Hit after splitting aces: no"
                ].join("\n")
            })
            .setThumbnail(client.user?.displayAvatarURL({ extension: "png" }))

        await interaction.reply({ embeds: [embed] })
    }
})
