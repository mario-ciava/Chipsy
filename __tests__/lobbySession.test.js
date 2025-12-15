const LobbySession = require("../bot/lobbies/lobbySession")

describe("LobbySession.refresh", () => {
    test("builds a fresh payload per message edit", async () => {
        let renderCount = 0
        const render = jest.fn(() => ({ content: `render-${++renderCount}` }))

        const session = new LobbySession({
            send: jest.fn(),
            render,
            logger: { error: jest.fn() },
            suppressNotifications: false
        })

        const statusMessage = { edit: jest.fn().mockResolvedValue(null) }
        const mirrorMessage = { edit: jest.fn().mockResolvedValue(null), channel: { id: "mirror" } }

        session.statusMessage = statusMessage
        session.mirrors.set("mirror", mirrorMessage)

        await session.refresh()

        expect(render).toHaveBeenCalledTimes(2)
        const [statusPayload] = statusMessage.edit.mock.calls[0]
        const [mirrorPayload] = mirrorMessage.edit.mock.calls[0]
        expect(statusPayload).not.toBe(mirrorPayload)
    })
})

