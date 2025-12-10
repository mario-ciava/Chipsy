const texas = require("./texas")
const blackjack = require("./blackjack")

const GAMES = {
    texas,
    blackjack
}

const normalizeGameId = (game) => {
    if (!game) return null
    const key = String(game).trim().toLowerCase()
    return GAMES[key] ? key : null
}

const getGameDefinition = (game) => {
    const key = normalizeGameId(game)
    return key ? GAMES[key] : null
}

module.exports = {
    GAMES,
    GAME_IDS: Object.keys(GAMES),
    getGameDefinition,
    normalizeGameId
}
