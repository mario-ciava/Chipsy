const toInteger = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return NaN
    return Math.floor(numeric)
}

const clampSafeInteger = (value) => {
    if (!Number.isFinite(value)) return 0
    const floored = Math.floor(value)
    if (floored < 0) return 0
    if (floored > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
    return floored
}

const sanitizePositiveAmount = (amount) => {
    const numeric = toInteger(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null
    }
    return clampSafeInteger(numeric)
}

const ensurePlayerData = (player) => {
    if (!player) return null
    if (!player.data) {
        player.data = {}
    }
    return player.data
}

const readStack = (player) => clampSafeInteger(toInteger(player?.stack))

const readBankroll = (player) => clampSafeInteger(toInteger(player?.data?.money))

const normalizeBuyIn = ({ requested, minBuyIn, maxBuyIn, bankroll }) => {
    const rawMin = toInteger(minBuyIn)
    let safeMin = 1
    if (Number.isFinite(rawMin) && rawMin > 0) safeMin = rawMin
    safeMin = clampSafeInteger(safeMin)

    const rawMax = toInteger(maxBuyIn)
    let safeMax = safeMin
    if (Number.isFinite(rawMax) && rawMax >= safeMin) safeMax = rawMax
    safeMax = clampSafeInteger(Math.max(safeMin, safeMax))

    const availableBankroll = clampSafeInteger(toInteger(bankroll))
    if (availableBankroll < safeMin) {
        return { ok: false, reason: "insufficientBankroll", min: safeMin, max: safeMax, bankroll: availableBankroll }
    }

    let desired = safeMin
    if (requested !== undefined && requested !== null) {
        const rawRequested = toInteger(requested)
        if (!Number.isFinite(rawRequested) || rawRequested <= 0) {
            return { ok: false, reason: "invalidAmount", min: safeMin, max: safeMax, bankroll: availableBankroll }
        }
        desired = rawRequested
    }

    if (desired < safeMin || desired > safeMax) {
        return { ok: false, reason: "outOfRange", min: safeMin, max: safeMax, bankroll: availableBankroll }
    }

    if (desired > availableBankroll) {
        return { ok: false, reason: "insufficientBankroll", min: safeMin, max: safeMax, bankroll: availableBankroll }
    }

    const amount = clampSafeInteger(desired)
    if (amount < safeMin) {
        return { ok: false, reason: "insufficientBankroll", min: safeMin, max: safeMax, bankroll: availableBankroll }
    }

    return { ok: true, amount, min: safeMin, max: safeMax, bankroll: availableBankroll }
}

const canAffordStack = (player, amount) => {
    if (!player) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    return readStack(player) >= sanitizedAmount
}

const withdrawStackOnly = (player, amount) => {
    if (!player) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    const currentStack = readStack(player)
    if (currentStack < sanitizedAmount) return false
    player.stack = clampSafeInteger(currentStack - sanitizedAmount)
    return true
}

const depositStackOnly = (player, amount) => {
    if (!player) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    player.stack = clampSafeInteger(readStack(player) + sanitizedAmount)
    return true
}

const syncStackToBankroll = (player) => {
    if (!player || !ensurePlayerData(player)) return false
    const currentStack = readStack(player)
    const currentBankroll = readBankroll(player)
    // Add stack back to bankroll (returning table stack to wallet)
    player.data.money = clampSafeInteger(currentBankroll + currentStack)
    player.stack = 0 // Reset stack after returning to bankroll
    return true
}

module.exports = {
    normalizeBuyIn,
    canAffordStack,
    withdrawStackOnly,
    depositStackOnly,
    syncStackToBankroll,
    getBankroll: readBankroll
}
