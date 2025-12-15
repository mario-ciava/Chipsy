const GameBroadcaster = require("../bot/games/shared/gameBroadcaster")

describe("GameBroadcaster mirrors and rounds", () => {
    test("inheritLobbyMirrors registers mirror targets with existing messages", () => {
        const mirrorChannelA = { id: "c1", send: jest.fn() }
        const mirrorChannelB = { id: "c2", send: jest.fn() }
        const mirrorMsgA = { id: "m1", channel: mirrorChannelA }
        const mirrorMsgB = { id: "m2", channel: mirrorChannelB }

        const lobbySession = {
            mirrors: new Map([
                ["c1", mirrorMsgA],
                ["c2", mirrorMsgB]
            ])
        }

        const broadcaster = new GameBroadcaster({})
        broadcaster.inheritLobbyMirrors(lobbySession)

        expect(broadcaster.targets.size).toBe(2)
        expect(broadcaster.targets.get("c1").message).toBe(mirrorMsgA)
        expect(broadcaster.targets.get("c2").message).toBe(mirrorMsgB)
        expect(broadcaster.primaryChannelId).toBe("c1")
    })

    test("prepareForNewRound clears messages but keeps channels", () => {
        const broadcaster = new GameBroadcaster({})
        broadcaster.targets.set("c1", { channel: { id: "c1" }, message: { id: "m1" } })
        broadcaster.targets.set("c2", { channel: { id: "c2" }, message: { id: "m2" } })

        broadcaster.prepareForNewRound()

        expect(broadcaster.targets.get("c1").message).toBeNull()
        expect(broadcaster.targets.get("c2").message).toBeNull()
    })

    test("unknown message errors do not drop mirror targets", async () => {
        const broadcaster = new GameBroadcaster({})
        const channel = { id: "c1", send: jest.fn() }
        const prevMsg = { id: "m1", edit: jest.fn().mockRejectedValue({ code: 10008 }) }
        broadcaster.targets.set("c1", { channel, message: prevMsg })

        await broadcaster.broadcast({ embeds: [] })

        expect(broadcaster.targets.has("c1")).toBe(true)
        expect(broadcaster.targets.get("c1").message).toBeNull()
    })
})

