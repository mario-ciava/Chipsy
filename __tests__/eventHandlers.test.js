const { MessageFlags } = require("discord.js")
const handleInteraction = require("../bot/events/interaction")

describe("interaction event handler", () => {
    const disabledNotice = "The bot is currently disabled by the administrators. Please try again later."

    const createInteraction = (overrides = {}) => {
        const router = {
            handleInteraction: jest.fn().mockResolvedValue(undefined)
        }

        return {
            id: "interaction-123",
            client: {
                config: { enabled: true, ...(overrides.client?.config || {}) },
                commandRouter: overrides.client?.commandRouter || router
            },
            replied: overrides.replied ?? false,
            deferred: overrides.deferred ?? false,
            reply: overrides.reply || jest.fn().mockResolvedValue(undefined),
            followUp: overrides.followUp || jest.fn().mockResolvedValue(undefined),
            respond: overrides.respond || jest.fn().mockResolvedValue(undefined),
            isAutocomplete: overrides.isAutocomplete || (() => false)
        }
    }

    test("short-circuits when the bot is disabled (regular command)", async() => {
        const reply = jest.fn().mockResolvedValue(undefined)
        const interaction = createInteraction({
            reply,
            client: { config: { enabled: false } }
        })

        await handleInteraction(interaction)

        expect(reply).toHaveBeenCalledWith({ content: disabledNotice, flags: MessageFlags.Ephemeral })
        expect(interaction.client.commandRouter.handleInteraction).not.toHaveBeenCalled()
    })

    test("responds with an empty list for disabled autocomplete interactions", async() => {
        const respond = jest.fn().mockResolvedValue(undefined)
        const interaction = createInteraction({
            respond,
            client: { config: { enabled: false } },
            isAutocomplete: () => true
        })

        await handleInteraction(interaction)

        expect(respond).toHaveBeenCalledWith([])
        expect(interaction.client.commandRouter.handleInteraction).not.toHaveBeenCalled()
    })

    test("hands interactions off to the command router when enabled", async() => {
        const interaction = createInteraction()

        await handleInteraction(interaction)

        expect(interaction.client.commandRouter.handleInteraction).toHaveBeenCalledTimes(1)
        expect(interaction.client.commandRouter.handleInteraction).toHaveBeenCalledWith(interaction)
    })

    test("ignores already handled interactions", async() => {
        const interaction = createInteraction({ replied: true })

        await handleInteraction(interaction)

        expect(interaction.client.commandRouter.handleInteraction).not.toHaveBeenCalled()
        expect(interaction.reply).not.toHaveBeenCalled()
    })
})
