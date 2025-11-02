const resolveUserTag = (user) => {
    if (!user) return null
    if (user.tag) return user.tag
    if (user.globalName && user.discriminator === "0") {
        return user.globalName
    }
    if (user.username && user.discriminator) {
        return `${user.username}#${user.discriminator}`
    }
    return user.username || null
}

const resolveCommandPath = (interaction) => {
    if (!interaction?.commandName) return null
    const segments = [interaction.commandName]

    try {
        if (typeof interaction.options?.getSubcommandGroup === "function") {
            const group = interaction.options.getSubcommandGroup(false)
            if (group) {
                segments.push(group)
            }
        }
    } catch (_error) {
        // Discord.js throws if the group is missing, ignore silently
    }

    try {
        if (typeof interaction.options?.getSubcommand === "function") {
            const sub = interaction.options.getSubcommand(false)
            if (sub && sub !== segments[segments.length - 1]) {
                segments.push(sub)
            }
        }
    } catch (_error) {
        // Same as above
    }

    return segments.filter(Boolean).join(" ")
}

const buildInteractionLogContext = (interaction, extraMeta = {}) => {
    if (!interaction) {
        return { ...extraMeta }
    }

    const base = {
        commandName: interaction.commandName || null,
        commandPath: resolveCommandPath(interaction),
        interactionId: interaction.id || null,
        userId: interaction.user?.id || null,
        userTag: resolveUserTag(interaction.user),
        userLocale: interaction.locale || interaction.user?.locale || null,
        guildId: interaction.guildId || interaction.guild?.id || null,
        guildName: interaction.guild?.name || null,
        channelId: interaction.channelId || interaction.channel?.id || null,
        channelName: interaction.channel?.name || null,
        isDM: Boolean(!interaction.guildId)
    }

    return { ...base, ...extraMeta }
}

module.exports = {
    resolveUserTag,
    resolveCommandPath,
    buildInteractionLogContext
}
