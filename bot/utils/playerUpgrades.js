const toPositiveInteger = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0
    }
    return Math.floor(numeric)
}

const resolveUpgradeLevel = (player, field) => {
    if (!player) return 0
    const fromData = toPositiveInteger(player?.data?.[field])
    if (fromData > 0) {
        return fromData
    }
    return toPositiveInteger(player?.[field])
}

const hasWinProbabilityInsight = (player) => resolveUpgradeLevel(player, "win_probability_upgrade") >= 1

module.exports = {
    hasWinProbabilityInsight
}
