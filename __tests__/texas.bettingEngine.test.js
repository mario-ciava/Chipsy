const BettingEngine = require("../bot/games/texas/bettingEngine")
const { createPlayer, createTexasStubGame } = require("../testUtils/texasTestUtils")

describe("Texas BettingEngine", () => {
    test("call commits up to currentMax and updates totals", () => {
        const { game } = createTexasStubGame({ currentMax: 200, minRaise: 50 })
        const player = createPlayer("p1", { stack: 500, currentBet: 50, totalBet: 50 })
        game.players = [player]

        const engine = new BettingEngine(game)
        const result = engine.executeAction("call", player)

        expect(result.success).toBe(true)
        expect(player.bets.current).toBe(200)
        expect(player.bets.total).toBe(200)
        expect(player.stack).toBe(350)
        expect(game.bets.total).toBe(150)
        expect(player.status.movedone).toBe(true)
        expect(player.status.lastAction.type).toBe("call")
    })

    test("raise updates currentMax/minRaise and resets others movedone", () => {
        const { game } = createTexasStubGame({ currentMax: 200, minRaise: 50 })
        game.getTableMinBet = jest.fn(() => 100)

        const raiser = createPlayer("a", { stack: 1000, currentBet: 200, totalBet: 200 })
        const other = createPlayer("b", { stack: 1000, currentBet: 200, totalBet: 200, status: { movedone: true } })
        game.players = [raiser, other]

        const engine = new BettingEngine(game)
        const result = engine.executeAction("raise", raiser, 350)

        expect(result.success).toBe(true)
        expect(raiser.bets.current).toBe(350)
        expect(game.bets.currentMax).toBe(350)
        expect(game.bets.minRaise).toBe(150)
        expect(other.status.movedone).toBe(false)
    })

    test("allin moves full stack and marks allIn", () => {
        const { game } = createTexasStubGame({ currentMax: 0, minRaise: 50 })
        const player = createPlayer("p1", { stack: 120, currentBet: 0, totalBet: 0 })
        game.players = [player]

        const engine = new BettingEngine(game)
        const result = engine.executeAction("allin", player)

        expect(result.success).toBe(true)
        expect(player.stack).toBe(0)
        expect(player.status.allIn).toBe(true)
        expect(player.status.lastAction.type).toBe("allin")
        expect(game.bets.total).toBe(120)
    })
})
