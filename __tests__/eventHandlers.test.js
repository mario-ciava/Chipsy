const handleMessage = require("../events/msg")
const handleInteraction = require("../events/interaction")

describe("event handlers respect bot enabled flag", () => {
    const disabledNotice = "The bot is currently disabled by the administrators. Please try again later."

    describe("message handler", () => {
        it("notifies users and skips routing when the bot is disabled", async() => {
            const send = jest.fn().mockResolvedValue()
            const handleMessageSpy = jest.fn().mockResolvedValue()

            const msg = {
                content: "!ping",
                author: { bot: false },
                client: {
                    config: { prefix: "!", enabled: false },
                    commandRouter: { handleMessage: handleMessageSpy }
                },
                channel: { send }
            }

            await handleMessage(msg)

            expect(send).toHaveBeenCalledWith(disabledNotice)
            expect(handleMessageSpy).not.toHaveBeenCalled()
        })

        it("routes commands normally when the bot is enabled", async() => {
            const send = jest.fn()
            const handleMessageSpy = jest.fn().mockResolvedValue()

            const msg = {
                content: "!ping",
                author: { bot: false },
                client: {
                    config: { prefix: "!", enabled: true },
                    commandRouter: { handleMessage: handleMessageSpy }
                },
                channel: { send }
            }

            await handleMessage(msg)

            expect(send).not.toHaveBeenCalled()
            expect(handleMessageSpy).toHaveBeenCalledTimes(1)
            expect(handleMessageSpy).toHaveBeenCalledWith(msg)
            expect(msg.command).toBe("ping")
        })
    })

    describe("interaction handler", () => {
        it("replies with a disabled notice when the bot is disabled", async() => {
            const reply = jest.fn().mockResolvedValue()
            const followUp = jest.fn().mockResolvedValue()
            const handleInteractionSpy = jest.fn()

            const interaction = {
                client: {
                    config: { enabled: false },
                    commandRouter: { handleInteraction: handleInteractionSpy }
                },
                deferred: false,
                replied: false,
                reply,
                followUp
            }

            await handleInteraction(interaction)

            expect(reply).toHaveBeenCalledWith({ content: disabledNotice, ephemeral: true })
            expect(followUp).not.toHaveBeenCalled()
            expect(handleInteractionSpy).not.toHaveBeenCalled()
        })

        it("routes interactions when the bot is enabled", async() => {
            const handleInteractionSpy = jest.fn().mockResolvedValue()

            const interaction = {
                client: {
                    config: { enabled: true },
                    commandRouter: { handleInteraction: handleInteractionSpy }
                },
                deferred: false,
                replied: false
            }

            await handleInteraction(interaction)

            expect(handleInteractionSpy).toHaveBeenCalledTimes(1)
            expect(handleInteractionSpy).toHaveBeenCalledWith(interaction)
        })
    })
})
