module.exports = async(client) => {
    console.info(`\nSuccessfully logged-in as ${client.user.tag}`)

    try {
        const slashCommands = client.commandRouter.getSlashCommandPayloads()
        await client.application.commands.set(slashCommands)
        console.info(`Registered ${slashCommands.length} application command(s).`)
    } catch (error) {
        console.error("Failed to register application commands:", error)
    }
}