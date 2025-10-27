const config = require("../../config")

const leaderboardSettings = config.leaderboard || {}
const sparklineSettings = leaderboardSettings.sparkline || {}
const winRateSettings = leaderboardSettings.winRate || {}
const trendSettings = leaderboardSettings.trend || {}
const STARTING_BANKROLL = config.constants?.database?.defaultMoney ?? 5000

const clamp01 = (value) => {
    if (!Number.isFinite(value)) return 0
    if (value < 0) return 0
    if (value > 1) return 1
    return value
}

const computeActivityScore = (entry, now = Date.now()) => {
    const halfLifeDays = leaderboardSettings.trend?.activityHalfLifeDays ?? 10
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000
    const lastPlayed = entry?.last_played ? new Date(entry.last_played).getTime() : null
    if (!Number.isFinite(lastPlayed)) {
        return 0.35
    }
    const age = now - lastPlayed
    if (!Number.isFinite(age) || age <= 0) {
        return 0.85
    }
    const normalized = 1 - age / (halfLifeMs * 2)
    return clamp01(normalized)
}

const computeMomentumSeries = (entry, length = sparklineSettings.points || 5) => {
    const safeLength = Math.max(length, 3)
    const winRate = entry?.hands_played > 0
        ? clamp01(entry.hands_won / entry.hands_played)
        : 0.25
    const levelProgress = entry?.required_exp > 0
        ? clamp01((entry.current_exp || 0) / entry.required_exp)
        : 0.35
    const bankrollMomentum = clamp01(Math.log10(Math.max(entry?.money || STARTING_BANKROLL, STARTING_BANKROLL)) / 8)
    const minHands = Number(winRateSettings.minHands) || 25
    const consistency = entry?.hands_played
        ? clamp01(entry.hands_played / Math.max(minHands * 3, 1))
        : 0.2
    const activity = computeActivityScore(entry)
    const seeds = [levelProgress, winRate, activity, bankrollMomentum, consistency]

    const series = []
    let cursor = seeds[0] ?? 0.4
    for (let i = 0; i < safeLength; i++) {
        const signal = seeds[i % seeds.length] ?? 0.5
        cursor = (cursor * 0.55) + (signal * 0.45)
        series.push(cursor)
    }
    return series
}

const buildMomentumSignature = (entry) => {
    const symbolSet = sparklineSettings.symbols || "▁▂▃▄▅▆▇█"
    const series = computeMomentumSeries(entry)
    const characters = series.map((value) => {
        const index = Math.max(0, Math.min(symbolSet.length - 1, Math.round(clamp01(value) * (symbolSet.length - 1))))
        return symbolSet[index] || leaderboardSettings.trend?.fallbackSymbol || "-"
    })
    const delta = series[series.length - 1] - series[0]
    const trendEmoji = delta > 0.02 ? "📈" : delta < -0.02 ? "📉" : "〰️"
    const trendDirection = delta > 0.02 ? "up" : delta < -0.02 ? "down" : "steady"
    return {
        signature: characters.join(""),
        trendEmoji,
        trendDirection,
        delta,
        colors: trendDirection === "up"
            ? trendSettings.upColor
            : trendDirection === "down"
                ? trendSettings.downColor
                : trendSettings.idleColor
    }
}

const formatWinRate = (entry) => {
    const decimals = Number.isFinite(winRateSettings.decimals) ? winRateSettings.decimals : 2
    const rate = entry?.win_rate ?? (
        entry?.hands_played > 0
            ? entry.hands_won / entry.hands_played
            : 0
    )
    return clamp01(rate) * 100
        ? `${(clamp01(rate) * 100).toFixed(decimals)}%`
        : `0.${"0".repeat(decimals - 1 || 0)}0%`
}

module.exports = {
    clamp01,
    computeActivityScore,
    computeMomentumSeries,
    buildMomentumSignature,
    formatWinRate
}
