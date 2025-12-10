const { createSettingsStore } = require("./store")
const { createGameSettingsResolver } = require("./gameSettingsResolver")
const { GAMES, GAME_IDS, getGameDefinition, normalizeGameId } = require("./games")

module.exports = {
    createSettingsStore,
    createGameSettingsResolver,
    GAMES,
    GAME_IDS,
    getGameDefinition,
    normalizeGameId
}
