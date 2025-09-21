const profileSlashCommand = require("../bot/commands/profile")
const createInteractionShim = require("./_interactionShim")

const run = async({ message } = {}) => {
    if (!message) {
        throw new Error("A message context is required to execute the profile command.")
    }

    const interaction = createInteractionShim(message, {
        getUser: () => null
    })

    return profileSlashCommand.execute(interaction, message.client)
}

module.exports = {
    ...profileSlashCommand,
    run
}
