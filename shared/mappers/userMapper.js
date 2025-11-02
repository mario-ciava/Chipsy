const defaultResolveUsername = async() => null

const toNumber = (value, fallback = 0) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : fallback
}

const mapProfileRecord = (record) => {
    if (!record) return null
    return {
        id: record.id,
        money: record.money,
        gold: record.gold,
        level: record.level,
        currentExp: record.current_exp,
        requiredExp: record.required_exp,
        handsPlayed: record.hands_played,
        handsWon: record.hands_won,
        netWinnings: record.net_winnings,
        biggestWon: record.biggest_won,
        biggestBet: record.biggest_bet,
        nextReward: record.next_reward,
        lastPlayed: record.last_played,
        joinDate: record.join_date
    }
}

const createUserSummaryMapper = ({
    resolveUsername = defaultResolveUsername,
    buildAccessPayload,
    ownerId
} = {}) => {
    return async(userRecord, accessRecord) => {
        if (!userRecord) return null
        const access = typeof buildAccessPayload === "function"
            ? buildAccessPayload({ userId: userRecord.id, ownerId, accessRecord })
            : null
        const handsPlayed = toNumber(userRecord.hands_played)
        const handsWon = toNumber(userRecord.hands_won)
        const winRate = handsPlayed > 0
            ? Number(((handsWon / handsPlayed) * 100).toFixed(2))
            : 0

        return {
            id: userRecord.id,
            username: await resolveUsername(userRecord.id),
            money: userRecord.money,
            gold: userRecord.gold,
            level: userRecord.level,
            currentExp: userRecord.current_exp,
            requiredExp: userRecord.required_exp,
            handsPlayed,
            handsWon,
            winRate,
            biggestWon: userRecord.biggest_won,
            biggestBet: userRecord.biggest_bet,
            netWinnings: userRecord.net_winnings,
            net_winnings: userRecord.net_winnings,
            withholdingUpgrade: userRecord.withholding_upgrade,
            rewardAmountUpgrade: userRecord.reward_amount_upgrade,
            rewardTimeUpgrade: userRecord.reward_time_upgrade,
            winProbabilityUpgrade: userRecord.win_probability_upgrade,
            nextReward: userRecord.next_reward,
            next_reward: userRecord.next_reward,
            lastPlayed: userRecord.last_played,
            joinDate: userRecord.join_date,
            join_date: userRecord.join_date,
            panelRole: access?.role,
            access
        }
    }
}

const buildStatsUpdatePayload = ({ level, currentExp, money, gold }) => ({
    level,
    current_exp: currentExp,
    money,
    gold
})

module.exports = {
    mapProfileRecord,
    createUserSummaryMapper,
    buildStatsUpdatePayload
}
