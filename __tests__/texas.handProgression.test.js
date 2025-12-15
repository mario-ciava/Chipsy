const HandProgression = require("../bot/games/texas/handProgression")
const { createPlayer, createTexasStubGame } = require("../testUtils/texasTestUtils")

describe("Texas HandProgression", () => {
    test("NextPhase(flopp) broadcasts settle frame then board frame", async () => {
        const p1 = createPlayer("a")
        const p2 = createPlayer("b")
        const { game } = createTexasStubGame({ players: [p1, p2] })
        game.cards = ["AS", "KS", "QS", "JS", "TS"]
        game.tableCards = []
        game.broadcastPhaseSnapshot = jest.fn(async () => {})
        game.findNextPendingPlayer = jest.fn(() => p1)
        game.NextPlayer = jest.fn().mockResolvedValue(undefined)

        const progression = new HandProgression(game)
        await progression.NextPhase("flop")

        expect(game.settleCurrentBetsForRender).toHaveBeenCalledTimes(1)
        expect(game.updateDisplayPotForRender).toHaveBeenCalledTimes(1)
        expect(game.broadcastPhaseSnapshot).toHaveBeenNthCalledWith(
            1,
            "Actions settled - preparing flop",
            { showdown: false }
        )
        expect(game.broadcastPhaseSnapshot).toHaveBeenNthCalledWith(
            2,
            "Flop",
            { showdown: false }
        )
        expect(game.tableCards).toHaveLength(3)
    })

    test("NextPhase(showdown) emits preparing snapshot before resolving", async () => {
        const p1 = createPlayer("a")
        const p2 = createPlayer("b")
        const { game } = createTexasStubGame({ players: [p1, p2] })
        game.tableCards = ["AS", "KS", "QS", "JS", "TS"]
        game.broadcastPhaseSnapshot = jest.fn(async () => {})

        const progression = new HandProgression(game)
        const showdownSpy = jest.spyOn(progression, "handleShowdown").mockResolvedValue(undefined)

        await progression.NextPhase("showdown")

        expect(game.settleCurrentBetsForRender).toHaveBeenCalledTimes(1)
        expect(game.updateDisplayPotForRender).toHaveBeenCalledTimes(1)
        expect(game.broadcastPhaseSnapshot).toHaveBeenCalledWith("Preparing showdown", { showdown: false })
        expect(showdownSpy).toHaveBeenCalledTimes(1)
    })

    test("NextPhase marks player movedone when all opponents are all-in", async () => {
        const p1 = createPlayer("a", { status: { allIn: true } })
        const p2 = createPlayer("b")
        const { game } = createTexasStubGame({ players: [p1, p2] })
        game.cards = ["AS", "KS", "QS", "JS", "TS"]
        game.tableCards = []
        game.broadcastPhaseSnapshot = jest.fn(async () => {})
        game.hasOpponentWithChips = jest.fn((player) => player.id !== "b")

        const progression = new HandProgression(game)
        jest.spyOn(progression, "handleShowdown").mockResolvedValue(undefined)
        await progression.NextPhase("flop")

        expect(game.hasOpponentWithChips).toHaveBeenCalledWith(p2)
        expect(p2.status.movedone).toBe(true)
    })
})
