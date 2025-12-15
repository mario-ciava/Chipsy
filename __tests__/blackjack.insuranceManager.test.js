const InsuranceManager = require("../bot/games/blackjack/insuranceManager")

describe("Blackjack InsuranceManager", () => {
    test("processInsurancePurchase withdraws half bet and resolveInsurance pays 2:1 when dealer has BJ", () => {
        const game = {
            dealer: { cards: ["AS", "??"] },
            appendDealerTimeline: jest.fn()
        }
        const player = {
            tag: "P1",
            stack: 1000,
            data: { money: 0, net_winnings: 0 },
            bets: { initial: 200, total: 200, insurance: 0 },
            status: {
                insurance: { wager: 0, settled: false },
                won: { grossValue: 0, netValue: 0 }
            }
        }

        const manager = new InsuranceManager(game)
        expect(manager.shouldOfferInsurance()).toBe(true)

        const purchase = manager.processInsurancePurchase(player, (p) => p.tag)
        expect(purchase.success).toBe(true)
        expect(purchase.insuranceAmount).toBe(100)
        expect(player.stack).toBe(900)
        expect(player.bets.insurance).toBe(100)
        expect(player.bets.total).toBe(300)

        const resolution = manager.resolveInsurance(true, player, (p) => p.tag)
        expect(resolution.paidOut).toBe(true)
        expect(resolution.payoutAmount).toBe(300)
        expect(player.stack).toBe(1200)
        expect(player.status.insurance.settled).toBe(true)
    })

    test("resolveInsurance marks loss when dealer has no BJ", () => {
        const game = { appendDealerTimeline: jest.fn() }
        const player = {
            tag: "P1",
            stack: 0,
            data: { money: 0 },
            bets: { initial: 100, total: 150, insurance: 50 },
            status: {
                insurance: { wager: 50, settled: false },
                won: { grossValue: 0, netValue: 0 }
            }
        }

        const manager = new InsuranceManager(game)
        const resolution = manager.resolveInsurance(false, player)

        expect(resolution.paidOut).toBe(false)
        expect(resolution.netWin).toBe(-50)
        expect(player.status.insurance.settled).toBe(true)
    })
})

