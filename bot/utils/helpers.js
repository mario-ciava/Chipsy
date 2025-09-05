/**
 * ============================================================================
 * HELPER UTILITIES - Funzioni di utilità generiche
 * ============================================================================
 */

/**
 * Crea una Promise che si risolve dopo un determinato tempo.
 * @param {number} ms - Millisecondi da attendere
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Formatta una data in modo relativo (es. "2 hours ago", "just now")
 * @param {Date|string|number} date - Data da formattare
 * @returns {string}
 */
const formatRelativeTime = (date) => {
    if (!date) return "Never"

    const now = Date.now()
    const then = date instanceof Date ? date.getTime() : new Date(date).getTime()

    if (isNaN(then)) return "Never"

    const diff = now - then
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (seconds < 60) return "Just now"
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
    if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
    if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`

    const months = Math.floor(days / 30)
    if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`

    const years = Math.floor(months / 12)
    return `${years} year${years !== 1 ? 's' : ''} ago`
}

/**
 * Formatta il tempo rimanente fino a una data (es. "2h 30m", "5d 3h")
 * @param {Date|string|number} targetDate - Data target
 * @returns {string}
 */
const formatTimeUntil = (targetDate) => {
    if (!targetDate) return "Available now"

    const now = Date.now()
    const then = targetDate instanceof Date ? targetDate.getTime() : new Date(targetDate).getTime()

    if (isNaN(then)) return "Unknown"

    const diff = then - now

    if (diff <= 0) return "Available now"

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
        const remainingHours = hours % 24
        return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
    }
    if (hours > 0) {
        const remainingMinutes = minutes % 60
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
    }
    if (minutes > 0) {
        const remainingSeconds = seconds % 60
        return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
    }

    return `${seconds}s`
}

/**
 * Crea una progress bar visuale
 * @param {number} current - Valore corrente
 * @param {number} max - Valore massimo
 * @param {number} length - Lunghezza della barra (default: 10)
 * @returns {string}
 */
const progressBar = (current, max, length = 10) => {
    const ratio = Math.min(Math.max(current / max, 0), 1)
    const filled = Math.round(ratio * length)
    const empty = length - filled
    const percentage = Math.round(ratio * 100)

    return `${'🟩'.repeat(filled)}${'⬜'.repeat(empty)} ${percentage}%`
}

module.exports = {
    sleep,
    delay: sleep, // Alias per retrocompatibilità
    formatRelativeTime,
    formatTimeUntil,
    progressBar
}
