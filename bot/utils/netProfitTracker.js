const clampPositiveInteger = (value) => {
    if (!Number.isFinite(value)) return 0
    const floored = Math.floor(value)
    if (floored <= 0) return 0
    return Math.min(floored, Number.MAX_SAFE_INTEGER)
}

const ensurePlayerData = (player) => {
    if (!player) return null
    if (!player.data) {
        player.data = {}
    }
    return player.data
}

const recordNetWin = (player, amount) => {
    if (!player || !ensurePlayerData(player)) return 0
    const increment = clampPositiveInteger(amount)
    if (increment <= 0) {
        return Number(player.data.net_winnings) || 0
    }

    const current = clampPositiveInteger(player.data.net_winnings)
    const next = Math.min(Number.MAX_SAFE_INTEGER, current + increment)
    player.data.net_winnings = next
    return next
}

module.exports = {
    recordNetWin
}
