const {
    BASE_REQUIRED_EXP,
    DEFAULT_PLAYER_LEVEL,
    calculateRequiredExp,
    normalizeUserExperience
} = require("../bot/utils/experience")

describe("experience helpers", () => {
    test("calculateRequiredExp returns base for level 0", () => {
        expect(calculateRequiredExp(0)).toBe(BASE_REQUIRED_EXP)
    })

    test("calculateRequiredExp increases with level", () => {
        const levelOne = calculateRequiredExp(1)
        const levelTwo = calculateRequiredExp(2)

        expect(levelOne).toBeGreaterThan(BASE_REQUIRED_EXP)
        expect(levelTwo).toBeGreaterThan(levelOne)
    })

    test("normalizeUserExperience converts legacy exp column", () => {
        const normalized = normalizeUserExperience({ level: 3, exp: 250 })
        expect(normalized.current_exp).toBe(250)
        expect(normalized.required_exp).toBe(calculateRequiredExp(3))
    })

    test("normalizeUserExperience guards against invalid values", () => {
        const normalized = normalizeUserExperience({ level: -10, current_exp: -5, required_exp: NaN })
        expect(normalized.level).toBe(DEFAULT_PLAYER_LEVEL)
        expect(normalized.current_exp).toBe(0)
        expect(normalized.required_exp).toBe(calculateRequiredExp(DEFAULT_PLAYER_LEVEL))
    })

    test("normalizeUserExperience coerces string based BIGINT values", () => {
        const normalized = normalizeUserExperience({
            level: "4",
            current_exp: "250",
            required_exp: "1000",
            money: "90071992547409910",
            gold: "15",
            hands_played: "12",
            hands_won: "5",
            biggest_won: "400",
            biggest_bet: "90071992547409920",
            withholding_upgrade: "3",
            reward_amount_upgrade: "2",
            reward_time_upgrade: "1",
            win_probability_upgrade: "5"
        })

        expect(normalized.level).toBe(4)
        expect(normalized.current_exp).toBe(250)
        expect(normalized.required_exp).toBe(1000)
        expect(normalized.money).toBe(Number.MAX_SAFE_INTEGER)
        expect(normalized.gold).toBe(15)
        expect(normalized.hands_played).toBe(12)
        expect(normalized.hands_won).toBe(5)
        expect(normalized.biggest_won).toBe(400)
        expect(normalized.biggest_bet).toBe(Number.MAX_SAFE_INTEGER)
        expect(normalized.withholding_upgrade).toBe(3)
        expect(normalized.reward_amount_upgrade).toBe(2)
        expect(normalized.reward_time_upgrade).toBe(1)
        expect(normalized.win_probability_upgrade).toBe(1)
    })
})
