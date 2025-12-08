const formatPercentage = (value, digits = 1) => {
    if (!Number.isFinite(value)) return null
    const clamped = Math.max(0, Math.min(1, value))
    return `${(clamped * 100).toFixed(digits)}%`
}

const buildProbabilityField = (probabilities = {}, options = {}) => {
    const {
        title = "Win probability",
        winLabel = "🟢 Win",
        tieLabel = "🟡 Tie",
        loseLabel = "🔴 Lose",
        digits = 1
    } = options

    const win = Number.isFinite(probabilities.win) ? probabilities.win : null
    const tie = Number.isFinite(probabilities.tie) ? probabilities.tie : null
    const loseProvided = Number.isFinite(probabilities.lose) ? probabilities.lose : null
    const lose = loseProvided !== null
        ? loseProvided
        : (win !== null || tie !== null)
            ? Math.max(0, 1 - ((win || 0) + (tie || 0)))
            : null

    const parts = []
    const pushPart = (label, value) => {
        const formatted = formatPercentage(value, digits)
        if (formatted) parts.push(`${label} ${formatted}`)
    }

    pushPart(winLabel, win)
    if (tie !== null) pushPart(tieLabel, tie)
    pushPart(loseLabel, lose)

    if (!parts.length) {
        return null
    }

    const value = parts.join(" • ") || "—"
    return {
        name: title,
        value,
        inline: false
    }
}

module.exports = {
    formatPercentage,
    buildProbabilityField
}
