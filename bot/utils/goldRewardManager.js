const config = require("../../config")

const defaultGoldRewardConfig = Object.freeze({
    perWinningHandChance: 0.03,
    perHandParticipationChance: 0.01,
    perWinningHandAmount: 1,
    perHandParticipationAmount: 1
})

const clampChance = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 0
    return Math.min(1, Math.max(0, numeric))
}

const resolveGoldRewardConfig = () => {
    const rewards = config?.rewards?.gold || {}
    return {
        perWinningHandChance: clampChance(rewards.perWinningHandChance ?? defaultGoldRewardConfig.perWinningHandChance),
        perHandParticipationChance: clampChance(rewards.perHandParticipationChance ?? defaultGoldRewardConfig.perHandParticipationChance),
        perWinningHandAmount: Number.isFinite(rewards.perWinningHandAmount) && rewards.perWinningHandAmount > 0
            ? rewards.perWinningHandAmount
            : defaultGoldRewardConfig.perWinningHandAmount,
        perHandParticipationAmount: Number.isFinite(rewards.perHandParticipationAmount) && rewards.perHandParticipationAmount > 0
            ? rewards.perHandParticipationAmount
            : defaultGoldRewardConfig.perHandParticipationAmount
    }
}

const shouldAward = (chance, rng = Math.random) => {
    const probability = clampChance(chance)
    if (probability <= 0) return false
    const roll = typeof rng === "function" ? rng() : Math.random()
    return roll >= 0 && roll < probability
}

const awardGoldForHand = (player, { wonHand = false, rng = Math.random } = {}) => {
    if (!player || !player.data) {
        return 0
    }

    const config = resolveGoldRewardConfig()
    let totalAwarded = 0

    if (wonHand && shouldAward(config.perWinningHandChance, rng)) {
        totalAwarded += config.perWinningHandAmount
    }

    if (shouldAward(config.perHandParticipationChance, rng)) {
        totalAwarded += config.perHandParticipationAmount
    }

    if (totalAwarded > 0) {
        const baseGold = Number(player.data.gold)
        const currentGold = Number.isFinite(baseGold) ? baseGold : 0
        player.data.gold = currentGold + totalAwarded
    }

    return totalAwarded
}

module.exports = {
    awardGoldForHand,
    resolveGoldRewardConfig,
    shouldAwardGold: shouldAward
}
