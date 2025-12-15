const RebuyManager = require("../bot/games/blackjack/rebuyManager")

describe("Blackjack RebuyManager", () => {
    const baseGame = () => ({
        settings: { allowRebuyMode: "once", rebuyWindowMs: 4500 },
        constructor: { settingDefaults: { rebuyWindowMs: 60000, minWindowMs: 30000, maxWindowMs: 600000 } }
    })

    test("canPlayerRebuy respects allowRebuyMode=once", () => {
        const manager = new RebuyManager(baseGame())
        expect(manager.canPlayerRebuy({ rebuysUsed: 0 })).toBe(true)
        expect(manager.canPlayerRebuy({ rebuysUsed: 1 })).toBe(false)
    })

    test("getRebuyWindowMs clamps to minimum window", () => {
        const manager = new RebuyManager(baseGame())
        expect(manager.getRebuyWindowMs()).toBe(30_000)
    })
})

