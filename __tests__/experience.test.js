const { BASE_REQUIRED_EXP, calculateRequiredExp, normalizeUserExperience } = require("../util/experience")

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
        expect(normalized.level).toBe(0)
        expect(normalized.current_exp).toBe(0)
        expect(normalized.required_exp).toBe(BASE_REQUIRED_EXP)
    })
})
