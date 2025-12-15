jest.mock("../bot/games/texas/texasRenderer", () => jest.fn())

const TexasGame = require("../bot/games/texas/texasGame")

describe("TexasGame helpers", () => {
    test("settleCurrentBetsForRender clears player current bets and table max", () => {
        const game = Object.create(TexasGame.prototype)
        game.players = [
            { bets: { current: 100 } },
            { bets: { current: 50 } }
        ]
        game.bets = { currentMax: 150 }

        game.settleCurrentBetsForRender()

        expect(game.players.map(p => p.bets.current)).toEqual([0, 0])
        expect(game.bets.currentMax).toBe(0)
    })

    test("updateDisplayPotForRender locks total plus settled side pots", () => {
        const game = Object.create(TexasGame.prototype)
        game.bets = {
            total: 200,
            pots: [{ amount: 50 }, { amount: 75 }],
            displayTotal: 0
        }

        game.updateDisplayPotForRender()

        expect(game.bets.displayTotal).toBe(325)
    })

    test("shouldPromptPlayer still prompts when facing all-in", () => {
        const game = Object.create(TexasGame.prototype)
        game.hasActiveOpponents = jest.fn(() => false)
        game.bets = { currentMax: 200 }

        const player = {
            stack: 100,
            bets: { current: 0 },
            status: { folded: false, removed: false, allIn: false, movedone: false }
        }

        expect(game.shouldPromptPlayer(player)).toBe(true)
    })
})
