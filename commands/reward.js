const rewardSlashCommand = require("../bot/commands/reward")
const createInteractionShim = require("./_interactionShim")

const run = async({ message } = {}) => {
    if (!message) {
        throw new Error("A message context is required to execute the reward command.")
    }

    const interaction = createInteractionShim(message)
    return rewardSlashCommand.execute(interaction, message.client)
}

module.exports = {
    ...rewardSlashCommand,
    run
}
