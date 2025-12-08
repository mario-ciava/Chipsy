/**
 * playerStateSchema.js
 *
 * Centralized schema and validators for player state.
 * Used by: texasGame.js, BettingEngine, GameRenderer, etc.
 *
 * Purpose: Single source of truth for player state structure and validation.
 */

const logger = require("../../utils/logger")

/**
 * MAX_SAFE_STACK: maximum allowed stack for a player.
 * Uses MAX_SAFE_INTEGER / 2 to avoid overflow during arithmetic operations.
 */
const MAX_SAFE_STACK = Number.MAX_SAFE_INTEGER / 2  // ~4.5e15

/**
 * validateStack(value): validate and normalize a stack amount.
 *
 * Returns: positive integer, clamped to MAX_SAFE_STACK.
 */
const validateStack = (value) => {
    const numeric = Number(value)

    // Not a finite number? -> 0
    if (!Number.isFinite(numeric)) return 0

    // Negative? -> 0
    if (numeric < 0) return 0

    // Above the safe limit? -> clamp and log
    if (numeric > MAX_SAFE_STACK) {
        logger.warn("Stack exceeds safe limit, clamping to maximum", {
            scope: "playerStateSchema",
            requested: numeric,
            max: MAX_SAFE_STACK
        })
        return MAX_SAFE_STACK
    }

    // Otherwise: floor to enforce integer
    return Math.floor(numeric)
}

/**
 * validateAmount(value, max): validate and normalize an amount (bet, contribution, etc).
 *
 * Used for: bets, commits, raises.
 * Returns: positive integer between 0 and max.
 */
const validateAmount = (value, max = MAX_SAFE_STACK) => {
    const numeric = Number(value)

    // Not finite? -> 0
    if (!Number.isFinite(numeric)) return 0

    // Clamp between 0 and max
    const clamped = Math.max(0, Math.min(max, numeric))

    // Floor to enforce integer
    return Math.floor(clamped)
}

/**
 * createPlayerStatus(): factory for a new player status object.
 *
 * Centralized here for consistency - this is the source of truth for the shape.
 */
const createPlayerStatus = () => ({
    // Game state
    folded: false,           // Player has folded?
    movedone: false,         // Player acted this betting round?
    allIn: false,            // Player is all-in (stack at 0)?
    removed: false,          // Removed from the table?
    leftThisHand: false,     // Left during this hand?
    pendingRemoval: false,   // Marked for removal after the hand ends
    pendingRebuy: false,     // In a rebuy window
    rebuyDeadline: null,     // Rebuy deadline timestamp
    pendingRejoin: false,    // Will rejoin on the next hand after rebuy

    // Action information
    lastAllInAmount: 0,      // Amount in the last all-in
    lastReminderHand: 0,     // Hand # of the last hole card reminder
    lastAction: null,        // { type, amount, total, ts, isBlind }
    totalContribution: 0,    // Total contributed to the current pot

    // Rendering/UI
    holeCardPanel: null,     // { hand: #, asset: AttachmentBuilder }

    // Probabilities (when the player has the subscription)
    winProbability: null,    // 0-1
    tieProbability: null,    // 0-1
    probabilitySamples: null // Number of samples used in the calculation
})

/**
 * createPlayerSession(user, stackAmount): factory for a new player object.
 *
 * Mirrors the initialization used in texasGame.js.
 * Centralized here to avoid duplication and inconsistencies.
 */
const createPlayerSession = (user, stackAmount) => {
    if (!user) return null

    // Safe display avatar - handles cases where displayAvatarURL is missing
    const safeDisplayAvatar =
        typeof user.displayAvatarURL === "function"
            ? (options) => user.displayAvatarURL(options)
            : () => null

    // Safe toString - falls back to a mention when unavailable
    const safeToString =
        typeof user.toString === "function"
            ? () => user.toString()
            : () => (user.id ? `<@${user.id}>` : "Player")

    // Tag formatting
    const tag =
        typeof user.tag === "string"
            ? user.tag
            : typeof user.username === "string"
            ? `${user.username}#${user.discriminator || "0000"}`
            : "Texas Hold'em player"

    // User data initialization
    const data = user.data ?? {}
    if (!Number.isFinite(data.hands_played)) data.hands_played = 0
    if (!Number.isFinite(data.hands_won)) data.hands_won = 0

    const validatedStack = validateStack(stackAmount)

    return {
        // Identity
        id: user.id,
        tag,
        username: user.username,
        bot: user.bot,
        data,
        client: user.client,
        user,

        // Money (validated)
        stack: validatedStack,
        entryStack: validatedStack, // Preserve original buy-in for lobby/summary renders
        newEntry: true,
        rebuysUsed: 0,

        // Methods
        toString: safeToString,
        displayAvatarURL: safeDisplayAvatar,

        // Game state
        status: createPlayerStatus(),
        bets: { current: 0, total: 0 },
        lastInteraction: null,
        hand: null,
        cards: []
    }
}

module.exports = {
    validateStack,
    validateAmount,
    MAX_SAFE_STACK,
    createPlayerStatus,
    createPlayerSession
}
