const ensureRegistry = (client) => {
    if (!client) return null

    if (!(client.activeGames instanceof Set)) {
        client.activeGames = new Set()
    }

    return client.activeGames
}

const formatTypeLabel = (name = "Game") => {
    const withoutSuffix = name.replace(/Game$/i, "")
    return withoutSuffix
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .trim()
        || "Table"
}

const ensureRemoteControl = (game) => {
    if (!game) return null
    if (!game.remoteControl || typeof game.remoteControl !== "object") {
        game.remoteControl = {}
    }

    const typeName = game.constructor?.name || "Game"

    if (!game.remoteControl.id) {
        const channelId = game.channel?.id || "room"
        const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
        game.remoteControl.id = `${typeName.replace(/Game$/i, "").toLowerCase()}-${channelId}-${seed}`
    }

    if (!game.remoteControl.type) {
        game.remoteControl.type = typeName.replace(/Game$/i, "").toLowerCase()
    }

    if (!game.remoteControl.label) {
        game.remoteControl.label = formatTypeLabel(typeName)
    }

    if (!game.remoteControl.createdAt) {
        game.remoteControl.createdAt = new Date().toISOString()
    }

    if (!game.remoteControl.channelId && game.channel?.id) {
        game.remoteControl.channelId = game.channel.id
    }

    if (!game.remoteControl.guildId && game.channel?.guild?.id) {
        game.remoteControl.guildId = game.channel.guild.id
    }

    return game.remoteControl
}

const registerGame = (client, game) => {
    if (!client || !game) return game
    ensureRemoteControl(game)
    const registry = ensureRegistry(client)
    registry?.add(game)
    return game
}

const getActiveGames = (client) => {
    const registry = client?.activeGames
    if (!(registry instanceof Set)) return []
    return Array.from(registry)
}

module.exports = {
    registerGame,
    getActiveGames
}
