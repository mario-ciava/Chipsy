const LobbySession = require("./lobbySession")

const createLobbySession = (options) => new LobbySession(options)

module.exports = {
    LobbySession,
    createLobbySession
}