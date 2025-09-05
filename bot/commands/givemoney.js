const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags } = require("discord.js")
const setSeparator = require("../utils/setSeparator")
const createCommand = require("../utils/createCommand")

const slashCommand = new SlashCommandBuilder()
    .setName("givemoney")
    .setDescription("[ADMIN] Give yourself money for testing purposes.")
    .addIntegerOption(option =>
        option
            .setName("amount")
            .setDescription("Amount of money to receive (default: 1 billion)")
            .setRequired(false)
            .setMinValue(1)
    )

module.exports = createCommand({
    name: "givemoney",
    description: "[ADMIN] Give yourself money for testing purposes.",
    slashCommand,
    defer: true,
    deferEphemeral: true,
    execute: async(interaction, client) => {
        const respond = async(payload = {}) => {
            if (interaction.deferred && !interaction.replied) {
                return interaction.editReply(payload)
            }
            if (!interaction.replied) {
                return interaction.reply(payload)
            }
            return interaction.followUp(payload)
        }

        const author = interaction.user

        // Check if user is bot owner
        const ownerId = process.env.DISCORD_OWNER_ID
        if (!ownerId || author.id !== ownerId) {
            await respond({
                content: "❌ This command is restricted to the bot owner only.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        if (!author.data) {
            await respond({
                content: "❌ Your profile is still loading. Please try again in a moment.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const dataHandler = client?.dataHandler ?? interaction.client?.dataHandler
        if (!dataHandler) {
            throw new Error("Data handler is not available on the client.")
        }

        // Get amount from options or default to 1 billion
        const amount = interaction.options.getInteger("amount") || 1_000_000_000

        // Add money to profile
        const oldBalance = author.data.money
        author.data.money += amount

        // Save to database
        await dataHandler.updateUserData(author.id, dataHandler.resolveDBUser(author))

        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle("💰 Money Added")
            .addFields(
                {
                    name: "Amount Added",
                    value: `**${setSeparator(amount)}$**`,
                    inline: true
                },
                {
                    name: "Previous Balance",
                    value: `${setSeparator(oldBalance)}$`,
                    inline: true
                },
                {
                    name: "New Balance",
                    value: `**${setSeparator(author.data.money)}$**`,
                    inline: true
                }
            )
            .setFooter({
                text: "Testing mode - Use responsibly",
                iconURL: author.displayAvatarURL({ extension: "png" })
            })

        await respond({ embeds: [embed], flags: MessageFlags.Ephemeral })
    }
})
