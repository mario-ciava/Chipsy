module.exports = async(interaction) => {
    if (!interaction?.client?.commandRouter) return

    await interaction.client.commandRouter.handleInteraction(interaction)
}

