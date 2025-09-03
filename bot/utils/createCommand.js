/**
 * Create a slash command - clean, simple, no abstractions.
 * Commands receive interaction and client directly.
 */
const createCommand = ({
    name,
    description,
    slashCommand,
    defer = true,
    deferEphemeral = true,
    dmPermission = false,
    defaultMemberPermissions,
    nsfw,
    execute
}) => {
    if (!name) throw new Error("Command requires a name")
    if (!description) throw new Error(`Command '${name}' requires a description`)
    if (!slashCommand?.toJSON) throw new Error(`Command '${name}' requires a SlashCommandBuilder`)
    if (typeof execute !== "function") throw new Error(`Command '${name}' requires an execute function`)

    const config = {
        name,
        description,
        slashCommand,
        defer,
        deferEphemeral,
        dmPermission,
        defaultMemberPermissions,
        nsfw
    }

    return { config, execute }
}

module.exports = createCommand
