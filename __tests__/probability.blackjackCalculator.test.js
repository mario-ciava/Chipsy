const createBlackjackCalculator = require("../shared/probability/blackjackCalculator")

describe("blackjack probability calculator", () => {
    const originalRandom = Math.random

    afterEach(() => {
        Math.random = originalRandom
    })

    it("draws for players before resolving the dealer to reflect real gameplay order", async () => {
        Math.random = () => 0

        const calculator = createBlackjackCalculator({
            config: {
                probabilities: {
                    shared: {},
                    blackjack: {
                        samples: {
                            default: 1,
                            min: 1,
                            max: 1
                        },
                        chunkSize: 0,
                        playerStrategy: {
                            standOnValue: 17,
                            hitSoft17: false
                        },
                        dealer: {
                            hitSoft17: false
                        }
                    }
                }
            },
            logger: {
                debug: () => {}
            }
        })

        const payload = await calculator.calculate({
            deck: { remaining: ["5S", "6S", "7S", "8S"] },
            dealer: { cards: ["9S", "7C"] },
            players: [
                {
                    id: "player-1",
                    hands: [
                        {
                            cards: ["TS", "6H"],
                            bet: 10
                        }
                    ]
                }
            ]
        }, { iterations: 1 })

        expect(payload).toBeTruthy()
        expect(payload.samples).toBe(1)

        const stats = payload.players["player-1"]
        expect(stats).toBeTruthy()
        expect(stats.win).toBe(1)
        expect(stats.lose).toBe(0)
        expect(stats.push).toBe(0)
        expect(stats.hands[0].win).toBe(1)
        expect(stats.hands[0].lose).toBe(0)
    })
})
