const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const createCommand = require("../utils/createCommand");
const { renderBlackjackTable, renderBlackjackTableSVG } = require("../utils/renderBlackjackTable");

const slashCommand = new SlashCommandBuilder()
    .setName("rendertest")
    .setDescription("Mostra un'anteprima grafica del tavolo di Blackjack.");

module.exports = createCommand({
    name: "rendertest",
    description: "Test rendering of blackjack table with various scenarios.",
    slashCommand: slashCommand.addStringOption(option =>
        option
            .setName("scenario")
            .setDescription("Test scenario to render")
            .setRequired(false)
            .addChoices(
                { name: "Player Blackjack (Win)", value: "player_bj" },
                { name: "Dealer Blackjack (Lose)", value: "dealer_bj" },
                { name: "Player Bust (Lose)", value: "player_bust" },
                { name: "Dealer Bust (Win)", value: "dealer_bust" },
                { name: "Split Hands", value: "split" },
                { name: "Push (Tie)", value: "push" },
                { name: "Simple Win", value: "simple_win" }
            )
    ),
    defer: true,
    errorMessage: "Failed to render blackjack table. Please try again.",
    execute: async (interaction, client) => {
        try {
            const scenario = interaction.options.getString("scenario") || "simple_win";

            // Define test scenarios
            const scenarios = {
                player_bj: {
                    playerName: interaction.user.username,
                    dealerCards: ["king_of_hearts", "7_of_clubs"],
                    dealerValue: 17,
                    playerHands: [{
                        cards: ["ace_of_spades", "queen_of_diamonds"],
                        value: 21,
                        blackjack: true,
                        bet: 10000
                    }],
                    result: "win",
                    title: "🎉 Blackjack! You Win!"
                },
                dealer_bj: {
                    playerName: interaction.user.username,
                    dealerCards: ["ace_of_hearts", "king_of_spades"],
                    dealerValue: 21,
                    dealerBlackjack: true,
                    playerHands: [{
                        cards: ["10_of_diamonds", "9_of_clubs"],
                        value: 19,
                        bet: 5000
                    }],
                    result: "lose",
                    title: "Dealer Blackjack - You Lose"
                },
                player_bust: {
                    playerName: interaction.user.username,
                    dealerCards: ["8_of_hearts", "9_of_clubs"],
                    dealerValue: 17,
                    playerHands: [{
                        cards: ["king_of_diamonds", "queen_of_hearts", "5_of_spades"],
                        value: 25,
                        busted: true,
                        bet: 7500
                    }],
                    result: "lose",
                    title: "Busted! You Lose"
                },
                dealer_bust: {
                    playerName: interaction.user.username,
                    dealerCards: ["10_of_clubs", "7_of_hearts", "6_of_diamonds"],
                    dealerValue: 23,
                    dealerBusted: true,
                    playerHands: [{
                        cards: ["9_of_spades", "8_of_hearts"],
                        value: 17,
                        bet: 12000
                    }],
                    result: "win",
                    title: "Dealer Busted! You Win!"
                },
                split: {
                    playerName: interaction.user.username,
                    dealerCards: ["king_of_clubs", "6_of_hearts"],
                    dealerValue: 16,
                    playerHands: [
                        {
                            cards: ["ace_of_spades", "10_of_diamonds"],
                            value: 21,
                            bet: 5000
                        },
                        {
                            cards: ["ace_of_hearts", "9_of_clubs"],
                            value: 20,
                            bet: 5000
                        }
                    ],
                    result: "win",
                    title: "Split Aces - Double Win!"
                },
                push: {
                    playerName: interaction.user.username,
                    dealerCards: ["king_of_diamonds", "9_of_spades"],
                    dealerValue: 19,
                    playerHands: [{
                        cards: ["10_of_clubs", "9_of_hearts"],
                        value: 19,
                        bet: 8000
                    }],
                    result: "push",
                    title: "Push - It's a Tie!"
                },
                simple_win: {
                    playerName: interaction.user.username,
                    dealerCards: ["queen_of_hearts", "7_of_clubs"],
                    dealerValue: 17,
                    playerHands: [{
                        cards: ["10_of_spades", "10_of_diamonds"],
                        value: 20,
                        bet: 15000
                    }],
                    result: "win",
                    title: "You Win!"
                }
            };

            const testData = scenarios[scenario];

            const pngBuffer = await renderBlackjackTable({ ...testData, outputFormat: "png" });
            const svgBuffer = await renderBlackjackTableSVG({ ...testData, outputFormat: "svg" }).catch(() => null);

            const pngAttachment = new AttachmentBuilder(pngBuffer, {
                name: "blackjack_table.png",
                contentType: "image/png",
                description: "Blackjack table rendering (PNG for inline preview)"
            });

            const attachments = [pngAttachment];
            if (svgBuffer) {
                attachments.push(new AttachmentBuilder(svgBuffer, {
                    name: "blackjack_table.svg",
                    contentType: "image/svg+xml",
                    description: "High-fidelity SVG snapshot"
                }));
            }

            const embed = new EmbedBuilder()
                .setTitle(`Test Scenario: ${scenario}`)
                .setDescription(`Rendered ${testData.playerHands.length} hand(s) for ${testData.playerName}${svgBuffer ? "\nSVG allegato." : ""}`)
                .setImage("attachment://blackjack_table.png")
                .setColor(testData.result === "win" ? "#00FF00" : testData.result === "lose" ? "#FF0000" : "#FFD700")
                .setFooter({ text: "High-quality rendering with image caching" });

            await interaction.editReply({ embeds: [embed], files: attachments });
        } catch (err) {
            const logger = require("../utils/logger");
            logger.error("Render test failed", {
                scope: "rendertest",
                error: err.message,
                stack: err.stack
            });
            await interaction.editReply({
                content: `❌ Rendering failed: ${err.message}`
            });
        }
    },
});
