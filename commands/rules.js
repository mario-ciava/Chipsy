const Discord = require("discord.js")
const { SlashCommandBuilder } = require("discord.js")
const logger = require("../util/logger")

const runRules = async (msg) => {
    try {
        const game = (msg.params[0] || "").toLowerCase()

        if (game !== "blackjack") {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Red)
                .setDescription("Please specify a supported game. Available options: blackjack.")
            return await msg.channel.send({ embeds: [embed] }).catch((error) => {
                logger.error("Failed to send rules error message", {
                    scope: "commands",
                    command: "rules",
                    userId: msg.author.id,
                    channelId: msg.channel.id,
                    error: error.message,
                    stack: error.stack
                })
                throw error
            })
        }

        await msg.channel.send({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({
                        name: "Blackjack rules",
                        value: `Dealer must stand on: 17 or higher\nInsurance pays: 2:1\nBlackjack pays: 3:2\nWithholding (default): 0.0024%\nNumber of decks: 3\nReshuffling: 25 cards or less\nDouble: any\nDouble after split: no\nHit after splitting aces: no`
                    })
                    .setThumbnail(msg.client.user.displayAvatarURL({ extension: "png" }))
            ]
        }).catch((error) => {
            logger.error("Failed to send rules message", {
                scope: "commands",
                command: "rules",
                userId: msg.author.id,
                channelId: msg.channel.id,
                game,
                error: error.message,
                stack: error.stack
            })
            throw error
        })
    } catch (error) {
        logger.error("Failed to execute rules command", {
            scope: "commands",
            command: "rules",
            userId: msg.author.id,
            error: error.message,
            stack: error.stack
        })

        try {
            await msg.channel.send({
                embeds: [
                    new Discord.EmbedBuilder()
                        .setColor(Discord.Colors.Red)
                        .setDescription("❌ An error occurred while loading the rules. Please try again later.")
                ]
            })
        } catch (sendError) {
            logger.error("Failed to send error message", {
                scope: "commands",
                command: "rules",
                error: sendError.message
            })
        }
    }
}

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

module.exports = {
    config: {
        name: "rules",
        aliases: ["rule"],
        description: "Show the rules for a supported game.",
        dmPermission: false,
        slashCommand
    },
    async run({ message }) {
        await runRules(message)
    }
}
