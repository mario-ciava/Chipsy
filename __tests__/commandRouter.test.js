jest.mock("discord.js", () => {
    class MockCollection extends Map {
        constructor(entries) {
            super(entries)
        }
    }

    class MockEmbedBuilder {
        constructor() {
            this.title = ""
            this.description = ""
            this.fields = []
            this.footer = null
            this.color = null
        }
        setColor(color) { this.color = color; return this }
        setTitle(title) { this.title = title; return this }
        setDescription(description) { this.description = description; return this }
        addFields(...fields) { this.fields.push(...fields); return this }
        setFooter(footer) { this.footer = footer; return this }
    }

    return {
        Collection: MockCollection,
        EmbedBuilder: MockEmbedBuilder,
        Colors: { Red: 0xff0000, Orange: 0xffa500, DarkGrey: 0x333333 },
        MessageFlags: {
            Ephemeral: 1 << 6
        }
    }
})

const mockSendInteractionResponse = jest.fn()

jest.mock("../bot/utils/interactionResponse", () => ({
    sendInteractionResponse: (...args) => mockSendInteractionResponse(...args)
}))

jest.mock("../shared/logger", () => ({
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    logAndSuppress: jest.fn(() => jest.fn())
}))

const CommandRouter = require("../bot/utils/commands/commandRouter")
const { MessageFlags } = require("discord.js")

const createSlashBuilder = () => ({
    toJSON: jest.fn(() => ({})),
    setDefaultMemberPermissions: jest.fn(),
    setDMPermission: jest.fn()
})

const createRouter = (overrides = {}) => {
    const client = {
        SetData: jest.fn().mockResolvedValue({ data: { money: 1000 } }),
        ...overrides.client
    }
    return { router: new CommandRouter(client), client }
}

const createInteraction = (overrides = {}) => ({
    id: overrides.id || "interaction",
    commandName: overrides.commandName || "test",
    isAutocomplete: overrides.isAutocomplete || (() => false),
    isChatInputCommand: overrides.isChatInputCommand || (() => true),
    deferReply: overrides.deferReply || jest.fn().mockResolvedValue(undefined),
    reply: overrides.reply || jest.fn().mockResolvedValue(undefined),
    followUp: overrides.followUp || jest.fn().mockResolvedValue(undefined),
    respond: overrides.respond || jest.fn().mockResolvedValue(undefined),
    responded: overrides.responded || false,
    deferred: overrides.deferred ?? false,
    replied: overrides.replied ?? false,
    user: overrides.user || { id: "user-123" },
    client: overrides.client
})

beforeEach(() => {
    jest.clearAllMocks()
})

describe("CommandRouter.handleInteraction", () => {
    test("defers, warms user data, and executes command", async() => {
        const { router, client } = createRouter()
        const execute = jest.fn().mockResolvedValue(undefined)
        router.register({
            config: {
                name: "test",
                slashCommand: createSlashBuilder(),
                defer: true,
                deferEphemeral: true
            },
            execute
        })

        const interaction = createInteraction({ client })

        await router.handleInteraction(interaction)

        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral })
        expect(client.SetData).toHaveBeenCalledWith(interaction.user)
        expect(interaction.user.data).toEqual({ money: 1000 })
        expect(execute).toHaveBeenCalledWith(interaction, client)
    })

    test("responds with handled error when user data fails to load", async() => {
        const sendSpy = mockSendInteractionResponse
        const { router, client } = createRouter({
            client: {
                SetData: jest.fn().mockResolvedValue({ error: { type: "database" } })
            }
        })

        router.register({
            config: {
                name: "test",
                slashCommand: createSlashBuilder()
            },
            execute: jest.fn()
        })

        const interaction = createInteraction({ client })

        await router.handleInteraction(interaction)

        expect(sendSpy).toHaveBeenCalledTimes(1)
        const errorPayload = sendSpy.mock.calls[0][1]
        expect(errorPayload.flags).toBe(MessageFlags.Ephemeral)
        expect(errorPayload.embeds[0].description).toBe("❌ Database connection failed. Please try again later.")
        expect(router.commands.get("test").execute).not.toHaveBeenCalled()
    })

    test("denies execution when user access is blocked", async() => {
        const evaluateBotAccess = jest.fn().mockResolvedValue({ allowed: false, reason: "blacklisted" })
        const { router, client } = createRouter({
            client: {
                accessControl: { evaluateBotAccess },
                SetData: jest.fn()
            }
        })

        const execute = jest.fn()
        router.register({
            config: {
                name: "test",
                slashCommand: createSlashBuilder()
            },
            execute
        })

        const interaction = createInteraction({ client })
        await router.handleInteraction(interaction)

        expect(execute).not.toHaveBeenCalled()
        expect(mockSendInteractionResponse).toHaveBeenCalledTimes(1)
        const denialPayload = mockSendInteractionResponse.mock.calls[0][1]
        expect(denialPayload.flags).toBe(MessageFlags.Ephemeral)
        expect(denialPayload.embeds[0].description).toBe("🚫 You are blacklisted and cannot use Chipsy.")
    })
})

describe("CommandRouter.handleAutocomplete", () => {
    test("responds with empty array when command is missing", async() => {
        const { router, client } = createRouter()
        const interaction = createInteraction({
            client,
            isAutocomplete: () => true,
            respond: jest.fn().mockResolvedValue(undefined)
        })

        await router.handleInteraction(interaction)

        expect(interaction.respond).toHaveBeenCalledWith([])
    })

    test("runs autocomplete handler after warming up user data", async() => {
        const autocomplete = jest.fn().mockResolvedValue([{ name: "Option", value: "opt" }])
        const { router, client } = createRouter()
        router.register({
            config: {
                name: "foo",
                slashCommand: createSlashBuilder()
            },
            execute: jest.fn(),
            autocomplete
        })

        const respond = jest.fn().mockResolvedValue(undefined)
        const interaction = createInteraction({
            commandName: "foo",
            client,
            isAutocomplete: () => true,
            respond
        })

        await router.handleInteraction(interaction)

        expect(client.SetData).toHaveBeenCalledWith(interaction.user)
        expect(interaction.user.data).toEqual({ money: 1000 })
        expect(autocomplete).toHaveBeenCalledWith(interaction, client)
        expect(respond).toHaveBeenCalledWith([{ name: "Option", value: "opt" }])
    })

    test("returns empty autocomplete when access is denied", async() => {
        const evaluateBotAccess = jest.fn().mockResolvedValue({ allowed: false, reason: "whitelist" })
        const respond = jest.fn().mockResolvedValue(undefined)
        const { router, client } = createRouter({
            client: {
                accessControl: { evaluateBotAccess }
            }
        })
        router.register({
            config: {
                name: "foo",
                slashCommand: createSlashBuilder()
            },
            execute: jest.fn(),
            autocomplete: jest.fn()
        })

        const interaction = createInteraction({
            commandName: "foo",
            client,
            isAutocomplete: () => true,
            respond
        })

        await router.handleInteraction(interaction)

        expect(respond).toHaveBeenCalledWith([])
        expect(evaluateBotAccess).toHaveBeenCalled()
    })
})
