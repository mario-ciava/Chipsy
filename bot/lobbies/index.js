const LobbySession = require("./lobbySession")
const {
    registerPublicLobby,
    unregisterPublicLobby,
    updateLobbyPlayerCount,
    findPublicLobbies,
    cleanupExpiredLobbies,
    countUserPublicLobbies
} = require("./publicLobbyRegistry")

const activeSessions = new Map()

const createLobbySession = (options) => {
    const session = new LobbySession(options)
    // We can't track it yet because we don't know the lobbyId until open() is called usually,
    // or until the consumer sets it.
    // So we'll rely on the consumer to register it if they want it tracked.
    return session
}

const registerActiveSession = (lobbyId, session) => {
    if (!lobbyId || !session) return
    activeSessions.set(lobbyId, session)
    
    // Auto-cleanup on close
    const cleanup = () => {
        if (activeSessions.get(lobbyId) === session) {
            activeSessions.delete(lobbyId)
        }
    }
    
    session.once("end", cleanup)
    // Also if destroyed
    // session.destroy() removes listeners, so we might miss "end" if destroyed externally
    // but typically "end" is emitted by collector end.
}

const getActiveSession = (lobbyId) => activeSessions.get(lobbyId)

module.exports = {
    LobbySession,
    createLobbySession,
    registerActiveSession,
    getActiveSession,
    registerPublicLobby,
    unregisterPublicLobby,
    updateLobbyPlayerCount,
    findPublicLobbies,
    cleanupExpiredLobbies,
    countUserPublicLobbies
}