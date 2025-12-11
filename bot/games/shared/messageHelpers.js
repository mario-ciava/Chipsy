const EMPTY_TIMELINE_TEXT = "No actions yet."

function formatTimelineStamp(date) {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime())
        ? date
        : new Date()
    const hh = safeDate.getHours().toString().padStart(2, "0")
    const mm = safeDate.getMinutes().toString().padStart(2, "0")
    const ss = safeDate.getSeconds().toString().padStart(2, "0")
    return `${hh}:${mm}:${ss}`
}

function formatTimeout(ms) {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) {
        return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) {
        return `${minutes}m`
    }
    return `${minutes}m ${remainingSeconds}s`
}

function resolvePlayerLabel(player) {
    if (!player) return "Player"
    return player.tag || player.username || player.name || player.user?.username || "Player"
}

function formatPlayerName(player) {
    return `**${resolvePlayerLabel(player)}**`
}

function resolvePlayerStackDisplay(player) {
    if (!player) return 0
    if (Number.isFinite(player.stack) && player.stack > 0) return player.stack
    if (Number.isFinite(player.pendingBuyIn) && player.pendingBuyIn > 0) return player.pendingBuyIn
    if (Number.isFinite(player.buyInAmount) && player.buyInAmount > 0) return player.buyInAmount
    return 0
}

module.exports = {
    EMPTY_TIMELINE_TEXT,
    formatTimelineStamp,
    formatTimeout,
    resolvePlayerLabel,
    formatPlayerName,
    resolvePlayerStackDisplay
}
