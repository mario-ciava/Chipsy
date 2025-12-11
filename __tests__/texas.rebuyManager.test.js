const TexasRebuyManager = require("../bot/games/texas/rebuyManager")

describe("TexasRebuyManager", () => {
    const baseGame = () => ({
        settings: { allowRebuyMode: "once", rebuyWindowMs: 4500 },
        getMinimumPlayers: () => 2,
        players: [],
        Stop: jest.fn(),
        StartGame: jest.fn(),
        rebuyOffers: new Map()
    })

    test("canPlayerRebuy respects allowRebuyMode=once", () => {
        const manager = new TexasRebuyManager(baseGame())
        expect(manager.canPlayerRebuy({ rebuysUsed: 0 })).toBe(true)
        expect(manager.canPlayerRebuy({ rebuysUsed: 1 })).toBe(false)
    })

    test("getRebuyWindowMs clamps to configured min window", () => {
        const manager = new TexasRebuyManager(baseGame())
        expect(manager.getRebuyWindowMs()).toBe(30_000)
        expect(manager.buildRebuyPauseFooter(4000)).toContain("4s")
    })
})
