const logger = require("./logger")

const DEFAULT_TESTER_BANKROLL = 1_000_000_000

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

const resolveTesterBankroll = ({ bankrollEnvKey = "BLACKJACK_TEST_BANKROLL", defaultBankroll = DEFAULT_TESTER_BANKROLL } = {}) => {
    const configured = toInteger(process.env[bankrollEnvKey])
    if (Number.isFinite(configured) && configured > 0) return clampSafeInteger(configured)
    return clampSafeInteger(defaultBankroll)
}

const syncPersistentBalance = async(dataHandler, player, context = {}) => {
    if (!dataHandler || typeof dataHandler.updateUserData !== "function" || typeof dataHandler.resolveDBUser !== "function") {
        return false
    }
    if (!player) return false
    try {
        await dataHandler.updateUserData(player.id, dataHandler.resolveDBUser(player))
        return true
    } catch (error) {
        const activeLogger = context.logger || logger
        if (activeLogger && typeof activeLogger.error === "function") {
            activeLogger.error("Failed to persist bankroll change", {
                scope: context.scope || "bankroll",
                action: context.action || "syncPersistentBalance",
                userId: player?.id,
                error: error.message,
                stack: error.stack
            })
        }
        return false
    }
}

const ensureTesterProvision = async({ user, client, testerUserId = process.env.BLACKJACK_TEST_USER_ID, bankrollEnvKey = "BLACKJACK_TEST_BANKROLL", defaultBankroll = DEFAULT_TESTER_BANKROLL } = {}) => {
    if (!user || !client || !testerUserId || user.id !== testerUserId) return
    if (!user.data) return
    const minimumBalance = resolveTesterBankroll({ bankrollEnvKey, defaultBankroll })
    if (readBankroll(user) >= minimumBalance) return
    user.data.money = minimumBalance
    await syncPersistentBalance(client.dataHandler, user, {
        scope: "bankroll",
        action: "ensureTesterProvision",
        userId: user.id
    })
}

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

const canAfford = (player, amount, { includeStack = true, includeBankroll = true } = {}) => {
    if (!player) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    const stack = readStack(player)
    const bankroll = readBankroll(player)
    if (includeStack && stack < sanitizedAmount) return false
    if (includeBankroll && bankroll < sanitizedAmount) return false
    return true
}

const canAffordStack = (player, amount) => {
    if (!player) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    return readStack(player) >= sanitizedAmount
}

const withdraw = (player, amount) => {
    if (!player || !ensurePlayerData(player)) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    if (!canAfford(player, sanitizedAmount)) return false
    player.stack = clampSafeInteger(readStack(player) - sanitizedAmount)
    player.data.money = clampSafeInteger(readBankroll(player) - sanitizedAmount)
    return true
}

const deposit = (player, amount) => {
    if (!player || !ensurePlayerData(player)) return false
    const sanitizedAmount = sanitizePositiveAmount(amount)
    if (sanitizedAmount === null) return false
    player.stack = clampSafeInteger(readStack(player) + sanitizedAmount)
    player.data.money = clampSafeInteger(readBankroll(player) + sanitizedAmount)
    return true
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
    DEFAULT_TESTER_BANKROLL,
    resolveTesterBankroll,
    ensureTesterProvision,
    normalizeBuyIn,
    canAfford,
    canAffordStack,
    withdraw,
    deposit,
    withdrawStackOnly,
    depositStackOnly,
    syncStackToBankroll,
    syncPersistentBalance,
    getStack: readStack,
    getBankroll: readBankroll
}
