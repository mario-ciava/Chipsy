jest.mock("discord.js", () => {
    class MockEmbed {
        constructor() {
            this.setColor = jest.fn(() => this)
            this.addFields = jest.fn(() => this)
            this.setFooter = jest.fn(() => this)
            this.setThumbnail = jest.fn(() => this)
            this.setDescription = jest.fn(() => this)
            this.setTitle = jest.fn(() => this)
        }
    }

    class MockSlashCommandBuilder {
        constructor() {
            this.setName = jest.fn(() => this)
            this.setDescription = jest.fn(() => this)
            this.toJSON = jest.fn(() => ({}))
        }

        addUserOption(handler) {
            if (typeof handler === "function") {
                const optionBuilder = {}
                optionBuilder.setName = jest.fn(() => optionBuilder)
                optionBuilder.setDescription = jest.fn(() => optionBuilder)
                optionBuilder.setRequired = jest.fn(() => optionBuilder)
                handler(optionBuilder)
            }
            return this
        }
    }

    class MockButtonBuilder {
        constructor() {
            this.setCustomId = jest.fn(() => this)
            this.setLabel = jest.fn(() => this)
            this.setStyle = jest.fn(() => this)
            this.setEmoji = jest.fn(() => this)
            this.setDisabled = jest.fn(() => this)
        }
    }

    class MockActionRowBuilder {
        constructor() {
            this.components = []
        }

        addComponents(...components) {
            this.components.push(...components)
            return this
        }

        static from(row) {
            const clone = new MockActionRowBuilder()
            clone.components = row?.components ? [...row.components] : []
            return clone
        }
    }

    class MockStringSelectMenuBuilder {
        constructor() {
            this.setCustomId = jest.fn(() => this)
            this.setPlaceholder = jest.fn(() => this)
            this.addOptions = jest.fn(() => this)
        }
    }

    const Colors = {
        Red: "#ff0000",
        Green: "#00ff00",
        Gold: "#ffd700",
        Aqua: "#00ffff",
        Orange: "#ffa500"
    }

    const ButtonStyle = {
        Primary: 1,
        Secondary: 2,
        Success: 3,
        Danger: 4
    }

    const MessageFlags = {
        Ephemeral: 1 << 6
    }

    return {
        EmbedBuilder: MockEmbed,
        SlashCommandBuilder: MockSlashCommandBuilder,
        MessageFlags,
        ButtonBuilder: MockButtonBuilder,
        ButtonStyle,
        ActionRowBuilder: MockActionRowBuilder,
        StringSelectMenuBuilder: MockStringSelectMenuBuilder,
        Colors
    }
})

jest.mock("../bot/games/features.js", () => ({
    applyUpgrades: jest.fn((feature) => {
        if (feature === "reward-amount") return 1500
        if (feature === "reward-time") return 1
        return 0
    }),
    get: jest.fn(() => ({ max: 10 })),
    getCosts: jest.fn(() => ["100"])
}))

const rewardCommand = require("../bot/commands/reward")
const profileCommand = require("../bot/commands/profile")
const { DEFAULT_PLAYER_LEVEL, calculateRequiredExp } = require("../bot/utils/experience")

const createCollectorStub = () => {
    const collector = {
        ended: false,
        on: jest.fn().mockReturnThis(),
        stop: jest.fn(() => {
            collector.ended = true
        })
    }
    return collector
}

const createResponseMessageStub = () => ({
    createMessageComponentCollector: jest.fn(() => createCollectorStub())
})

const createMockInteraction = (overrides = {}) => {
    const { data: overrideUserData, ...userOverrides } = overrides.user || {}

    const userData = {
        money: 5000,
        gold: 1,
        current_exp: 0,
        required_exp: calculateRequiredExp(DEFAULT_PLAYER_LEVEL),
        level: DEFAULT_PLAYER_LEVEL,
        hands_played: 0,
        hands_won: 0,
        biggest_won: 0,
        biggest_bet: 0,
        withholding_upgrade: 0,
        reward_amount_upgrade: 0,
        reward_time_upgrade: 0,
        next_reward: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        last_played: new Date().toISOString(),
        ...(overrideUserData || {})
    }

    const user = {
        id: "user-123",
        username: "Tester",
        tag: "Tester#0001",
        displayAvatarURL: jest.fn().mockReturnValue("https://avatar"),
        ...userOverrides,
        data: userData
    }

    const client = {
        dataHandler: {
            updateUserData: jest.fn().mockResolvedValue(undefined),
            resolveDBUser: jest.fn((targetUser) => ({
                money: targetUser.data.money,
                gold: targetUser.data.gold
            }))
        },
        ...(overrides.client || {})
    }

    const responseMessage = createResponseMessageStub()

    const interaction = {
        user,
        client,
        channel: { id: "channel-123", ...(overrides.channel || {}) },
        deferred: false,
        replied: false,
        options: {
            getUser: jest.fn(() => overrides.targetUser ?? null)
        },
        reply: jest.fn(async() => responseMessage),
        editReply: jest.fn(async() => responseMessage),
        followUp: jest.fn(async() => responseMessage)
    }

    return { interaction, user, client }
}

describe("reward command", () => {
    test("updates balance and persists the change", async() => {
        const { interaction, user, client } = createMockInteraction()

        await rewardCommand.execute(interaction, client)

        expect(user.data.money).toBe(6500)
        expect(client.dataHandler.resolveDBUser).toHaveBeenCalledWith(user)
        expect(client.dataHandler.updateUserData).toHaveBeenCalledWith(
            user.id,
            { money: 6500, gold: 1 }
        )
        expect(user.data.next_reward).toBeInstanceOf(Date)
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })
})

describe("profile command", () => {
    test("normalizes string based BIGINT fields before rendering", async() => {
        const { interaction, user, client } = createMockInteraction({
            user: {
                data: {
                    money: "7500",
                    gold: "3",
                    current_exp: "125",
                    required_exp: "200",
                    level: "2",
                    hands_played: "25",
                    hands_won: "10",
                    biggest_won: "5000",
                    biggest_bet: "1000",
                    withholding_upgrade: "1",
                    reward_amount_upgrade: "2",
                    reward_time_upgrade: "3",
                    next_reward: null,
                    last_played: "2024-01-01T00:00:00.000Z"
                }
            }
        })

        await profileCommand.execute(interaction, client)

        expect(typeof user.data.money).toBe("number")
        expect(typeof user.data.gold).toBe("number")
        expect(typeof user.data.biggest_bet).toBe("number")
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })
})
