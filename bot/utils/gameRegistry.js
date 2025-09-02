const ensureRegistry = (client) => {
    if (!client) return null

    if (!(client.activeGames instanceof Set)) {
        client.activeGames = new Set()
    }

    return client.activeGames
}

const registerGame = (client, game) => {
    if (!client || !game) return game
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
