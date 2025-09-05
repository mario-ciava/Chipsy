/**
 * ============================================================================
 * UPGRADE SYSTEM CONFIGURATION
 * ============================================================================
 *
 * Centralized configuration for all upgrades in the Chipsy system.
 * Edit this file to modify costs, max levels, benefits, and descriptions.
 */

/**
 * Upgrade definitions
 * Each upgrade has:
 * - id: Internal identifier
 * - name: Display name
 * - emoji: Emoji icon
 * - description: Short description
 * - details: Detailed explanation
 * - startingCost: Base cost for level 1
 * - costIncrease: Multiplier for cost scaling (higher = steeper curve)
 * - maxLevel: Maximum level achievable
 * - baseValue: Starting value/effect
 * - valuePerLevel: Change per level
 * - applyFunction: How to calculate the value at a given level
 */

const UPGRADES = {
    /**
     * WITHHOLDING TAX UPGRADE
     * Reduces the percentage of winnings taken as tax
     */
    "withholding": {
        id: "withholding",
        dbField: "withholding_upgrade",
        featureKey: "with-holding",

        // Display info
        name: "Withholding Tax",
        emoji: "💵",
        description: "Reduces the tax deducted from your winnings when you win a considerable amount of money.",
        details: "Withholding tax is **8x higher** in Blackjack games. Each upgrade level has **2.5x** the standard effect, making it particularly valuable for high-stakes players.",

        // Costs
        startingCost: 250000,      // $250k for level 1
        costIncrease: 1000,        // Scaling factor for exponential growth
        maxLevel: 10,

        // Values & Effects
        baseValue: 0.0003,         // 0.03% base tax
        valuePerLevel: -0.00002,   // Reduces by 0.002% per level

        // Special multipliers (used in blackjackGame.js)
        blackjackMultiplier: 8,    // Tax is 8x in blackjack
        effectMultiplier: 2.5,     // Each level is 2.5x more effective

        // Format for display
        format: (value) => `${(value * 100).toFixed(3)}%`,
        formatPrefix: "-",

        // Apply function: how value changes with level
        apply: (baseValue, level, valuePerLevel) => {
            let result = baseValue + (valuePerLevel * level)
            result = parseFloat(result.toFixed(5))
            return Math.max(0, result) // Can't be negative
        }
    },

    /**
     * REWARD AMOUNT UPGRADE
     * Increases daily reward money
     */
    "reward_amount": {
        id: "reward_amount",
        dbField: "reward_amount_upgrade",
        featureKey: "reward-amount",

        // Display info
        name: "Daily Reward Amount",
        emoji: "🏆",
        description: "Increases the amount of money you receive from your daily reward.",
        details: "Each level multiplies your reward amount by **1.5x**, allowing you to earn significantly more over time.",

        // Costs
        startingCost: 250000,      // $250k for level 1
        costIncrease: 1500,        // Scaling factor
        maxLevel: 10,

        // Values & Effects
        baseValue: 25000,          // $25k base reward
        valuePerLevel: 1.5,        // 1.5x multiplier per level

        // Format for display
        format: (value) => `+${Math.floor(value).toLocaleString()}$`,

        // Apply function: multiplicative growth
        apply: (baseValue, level, multiplier) => {
            let result = baseValue
            for (let i = 0; i < level; i++) {
                result = parseInt(result * multiplier)
            }
            return result
        }
    },

    /**
     * REWARD TIME UPGRADE
     * Reduces cooldown between daily rewards
     */
    "reward_time": {
        id: "reward_time",
        dbField: "reward_time_upgrade",
        featureKey: "reward-time",

        // Display info
        name: "Daily Reward Cooldown",
        emoji: "⏳",
        description: "Decreases the time you need to wait before redeeming another daily reward.",
        details: "Each level reduces the cooldown by **0.5 hours**, down to a minimum of **1 hour** between rewards.",

        // Costs
        startingCost: 150000,      // $150k for level 1 (cheaper than others)
        costIncrease: 1250,        // Scaling factor
        maxLevel: 5,               // Lower max level (can't reduce time too much)

        // Values & Effects
        baseValue: 24,             // 24 hours base cooldown
        valuePerLevel: -0.5,       // Reduces by 0.5h per level
        minValue: 1,               // Minimum 1 hour cooldown

        // Format for display
        format: (value) => `${value}h`,

        // Apply function: linear reduction with minimum
        apply: (baseValue, level, reduction, minValue = 1) => {
            let result = baseValue + (reduction * level)
            return Math.max(minValue, result) // Can't go below minimum
        }
    }
}

/**
 * Calculate the cost of an upgrade at a specific level
 * Uses square root scaling for exponential-ish growth
 */
function calculateUpgradeCost(upgradeId, level) {
    const upgrade = UPGRADES[upgradeId]
    if (!upgrade) return null

    if (level < 0 || level >= upgrade.maxLevel) return null

    const costs = [upgrade.startingCost]

    for (let i = 0; i < upgrade.maxLevel; i++) {
        const lastCost = costs[i]
        const nextCost = lastCost + parseInt(Math.sqrt(lastCost) * upgrade.costIncrease)
        costs.push(nextCost)
    }

    return costs[level]
}

/**
 * Get all costs for an upgrade (0 to maxLevel)
 */
function getAllUpgradeCosts(upgradeId, withSeparator = false) {
    const upgrade = UPGRADES[upgradeId]
    if (!upgrade) return null

    const costs = [upgrade.startingCost]

    for (let i = 0; i < upgrade.maxLevel; i++) {
        const lastCost = costs[i]
        const nextCost = lastCost + parseInt(Math.sqrt(lastCost) * upgrade.costIncrease)
        costs.push(nextCost)
    }

    if (withSeparator) {
        const setSeparator = require("../bot/utils/setSeparator")
        return costs.map(cost => setSeparator(cost))
    }

    return costs
}

/**
 * Calculate the value/effect of an upgrade at a specific level
 */
function calculateUpgradeValue(upgradeId, level) {
    const upgrade = UPGRADES[upgradeId]
    if (!upgrade) return null

    const safeLevel = Math.max(0, Math.min(level, upgrade.maxLevel))

    return upgrade.apply(
        upgrade.baseValue,
        safeLevel,
        upgrade.valuePerLevel,
        upgrade.minValue
    )
}

/**
 * Get upgrade config by ID
 */
function getUpgrade(upgradeId) {
    return UPGRADES[upgradeId] || null
}

/**
 * Get all upgrade IDs
 */
function getAllUpgradeIds() {
    return Object.keys(UPGRADES)
}

/**
 * Get upgrade by database field name
 */
function getUpgradeByDbField(dbField) {
    return Object.values(UPGRADES).find(upgrade => upgrade.dbField === dbField) || null
}

module.exports = {
    UPGRADES,
    calculateUpgradeCost,
    getAllUpgradeCosts,
    calculateUpgradeValue,
    getUpgrade,
    getAllUpgradeIds,
    getUpgradeByDbField
}
