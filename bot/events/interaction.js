const { MessageFlags } = require("discord.js")

module.exports = async(interaction) => {
    if (!interaction?.client?.commandRouter) return

    const isAutocompleteInteraction = typeof interaction.isAutocomplete === "function" && interaction.isAutocomplete()

    if (interaction.replied || interaction.deferred) {
        return
    }

    if (!interaction.client.config?.enabled) {
        if (isAutocompleteInteraction) {
            await interaction.respond([]).catch(() => null)
        } else {
            const response = {
                content: "The bot is currently disabled by the administrators. Please try again later.",
                flags: MessageFlags.Ephemeral
            }

            try {
                await interaction.reply(response)
            } catch (error) {
                // Interaction already handled elsewhere, ignore
            }
        }
        return
    }

    await interaction.client.commandRouter.handleInteraction(interaction)
}
