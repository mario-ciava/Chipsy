module.exports = async(interaction) => {
    if (!interaction?.client?.commandRouter) return

    if (!interaction.client.config?.enabled) {
        const response = {
            content: "The bot is currently disabled by the administrators. Please try again later.",
            ephemeral: true
        }

        if (interaction.deferred && !interaction.replied) {
            await interaction.followUp(response).catch(() => null)
        } else if (!interaction.replied) {
            await interaction.reply(response).catch(() => null)
        }
        return
    }

    await interaction.client.commandRouter.handleInteraction(interaction)
}

