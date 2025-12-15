const SplitManager = require("../bot/games/blackjack/splitManager")

describe("Blackjack SplitManager", () => {
    test("performSplit splits a pair, withdraws cost, and deals new cards", async () => {
        const game = {
            cards: ["2C", "3D"],
            PickRandom: jest.fn(async (cards, n) => cards.splice(0, n)),
            ComputeHandsValue: jest.fn().mockResolvedValue(undefined),
            appendDealerTimeline: jest.fn()
        }

        const player = {
            tag: "P1",
            stack: 500,
            bets: { initial: 100, total: 100, insurance: 0 },
            hands: [{
                cards: ["8H", "8D"],
                pair: true,
                fromSplitAce: false
            }]
        }

        const manager = new SplitManager(game)
        const result = await manager.performSplit(player, 0, (p) => p.tag)

        expect(result.success).toBe(true)
        expect(player.stack).toBe(400)
        expect(player.bets.total).toBe(200)
        expect(player.hands).toHaveLength(2)
        expect(player.hands[0].cards).toEqual(["8H", "3D"])
        expect(player.hands[1].cards).toEqual(["8D", "2C"])
        expect(game.ComputeHandsValue).toHaveBeenCalledWith(player)
        expect(game.appendDealerTimeline).toHaveBeenCalledWith("P1 splits hand.")
    })

    test("performSplit marks split-ace hands correctly", async () => {
        const game = {
            cards: ["5C", "9D"],
            PickRandom: jest.fn(async (cards, n) => cards.splice(0, n)),
            ComputeHandsValue: jest.fn().mockResolvedValue(undefined),
            appendDealerTimeline: jest.fn()
        }

        const player = {
            tag: "AceGuy",
            stack: 500,
            bets: { initial: 100, total: 100, insurance: 0 },
            hands: [{
                cards: ["AH", "AD"],
                pair: true,
                fromSplitAce: false
            }]
        }

        const manager = new SplitManager(game)
        const result = await manager.performSplit(player, 0, (p) => p.tag)

        expect(result.success).toBe(true)
        expect(result.splitAce).toBe(true)
        expect(player.hands[0].fromSplitAce).toBe(true)
        expect(player.hands[1].fromSplitAce).toBe(true)
    })
})

