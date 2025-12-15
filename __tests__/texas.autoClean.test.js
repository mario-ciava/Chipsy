jest.useFakeTimers()

jest.mock("../bot/games/texas/texasRenderer", () => jest.fn())

const TexasGame = require("../bot/games/texas/texasGame")

describe("Texas auto-clean scheduling", () => {
    test("scheduleHandCleanup deletes round renders and hole cards after 15s", async () => {
        const game = Object.create(TexasGame.prototype)
        game.settings = { autoCleanHands: true }
        game.cleanupTimers = new Set()

        const roundMessage = { delete: jest.fn().mockResolvedValue(undefined) }
        game.broadcaster = {
            getCurrentMessages: jest.fn(() => [roundMessage])
        }

        game.scheduleMessageCleanup = (target, delayMs) => {
            const delay = typeof delayMs === "number" ? delayMs : 15_000
            const timer = setTimeout(() => {
                target.delete().catch(() => null)
            }, delay)
            game.cleanupTimers.add(timer)
        }

        const holeMessage = { id: "hole", delete: jest.fn().mockResolvedValue(undefined) }
        const player = { status: { holeCardMessage: { hand: 2, message: holeMessage, interaction: null } } }
        game.players = [player]

        game.scheduleHandCleanup(2)

        jest.advanceTimersByTime(15_000)
        await Promise.resolve()

        expect(roundMessage.delete).toHaveBeenCalledTimes(1)
        expect(holeMessage.delete).toHaveBeenCalledTimes(1)
        expect(player.status.holeCardMessage).toBeNull()
    })

    test("Stop keeps auto-clean timers alive (round render deleted after 15s)", async () => {
        const game = Object.create(TexasGame.prototype)
        game.settings = { autoCleanHands: true }
        game.cleanupTimers = new Set()
        game.hands = 2

        const roundMessage = { delete: jest.fn().mockResolvedValue(undefined) }
        game.broadcaster = {
            getCurrentMessages: jest.fn(() => [roundMessage]),
            cleanup: jest.fn()
        }

        game.players = []
        game.messages = {
            cleanupHoleCardsMessages: jest.fn().mockResolvedValue(undefined)
        }

        game.refundOutstandingBets = jest.fn(() => 0)
        game.refundPlayers = jest.fn().mockResolvedValue(undefined)
        game.rebuyOffers = new Map()
        game.client = { activeGames: new Set([game]) }
        game.channel = { id: "c1", game }

        await game.Stop({ reason: "canceled" })

        jest.advanceTimersByTime(15_000)
        await Promise.resolve()

        expect(roundMessage.delete).toHaveBeenCalledTimes(1)
    })
})
