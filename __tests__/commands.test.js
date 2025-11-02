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

    class MockModalBuilder {
        constructor() {
            this.setTitle = jest.fn(() => this)
            this.setCustomId = jest.fn(() => this)
            this.addComponents = jest.fn(() => this)
        }
    }

    class MockTextInputBuilder {
        constructor() {
            this.setCustomId = jest.fn(() => this)
            this.setLabel = jest.fn(() => this)
            this.setPlaceholder = jest.fn(() => this)
            this.setStyle = jest.fn(() => this)
            this.setRequired = jest.fn(() => this)
            this.setMaxLength = jest.fn(() => this)
            this.setMinLength = jest.fn(() => this)
        }
    }

    return {
        EmbedBuilder: MockEmbed,
        SlashCommandBuilder: MockSlashCommandBuilder,
        ButtonBuilder: MockButtonBuilder,
        ActionRowBuilder: MockActionRowBuilder,
        StringSelectMenuBuilder: MockStringSelectMenuBuilder,
        ModalBuilder: MockModalBuilder,
        TextInputBuilder: MockTextInputBuilder,
        TextInputStyle: { Short: 1, Paragraph: 2 },
        MessageFlags: { Ephemeral: 1 << 6 },
        ButtonStyle: {
            Primary: 1,
            Secondary: 2,
            Success: 3,
            Danger: 4
        },
        Colors: {
            Red: "#ff0000",
            Green: "#00ff00",
            Gold: "#ffd700",
            Aqua: "#00ffff",
            Orange: "#ffa500",
            Purple: "#800080"
        }
    }
})

jest.mock("../shared/features.js", () => ({
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

const createDefaultProfile = () => ({
    money: 5000,
    gold: 1,
    current_exp: 0,
    required_exp: 100,
    level: 0,
    hands_played: 0,
    hands_won: 0,
    biggest_won: 0,
    biggest_bet: 0,
    withholding_upgrade: 0,
    reward_amount_upgrade: 0,
    reward_time_upgrade: 0,
    win_probability_upgrade: 0,
    next_reward: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    last_played: new Date().toISOString()
})

const createResponseMessageStub = () => {
    const message = {
        id: `message-${Math.random().toString(16).slice(2)}`,
        embeds: [],
        components: [],
        edit: jest.fn().mockResolvedValue(null),
        createMessageComponentCollector: jest.fn(() => ({
            stop: jest.fn(),
            on: jest.fn()
        }))
    }
    return message
}

const createMockInteraction = (overrides = {}) => {
    const responseMessage = createResponseMessageStub()

    const userOverrides = overrides.user || {}
    const user = {
        id: userOverrides.id || "user-123",
        tag: userOverrides.tag || "Tester#0001",
        username: userOverrides.username || "Tester",
        toString: userOverrides.toString || (() => `<@${userOverrides.id || "user-123"}>`),
        displayAvatarURL: userOverrides.displayAvatarURL || jest.fn(() => "https://avatar"),
        data: { ...createDefaultProfile(), ...(userOverrides.data || {}) },
        ...(userOverrides || {})
    }

    const dataHandler =
        overrides.client?.dataHandler || {
            updateUserData: jest.fn().mockResolvedValue(undefined),
            resolveDBUser: jest.fn(() => ({
                money: user.data.money,
                gold: user.data.gold
            }))
        }

    const client = {
        dataHandler,
        SetData: jest.fn().mockResolvedValue({ error: null }),
        ...(overrides.client || {})
    }

    const options = {
        getUser: jest.fn(() => overrides.targetUser ?? null),
        ...(overrides.options || {})
    }

    const interaction = {
        id: "interaction-1",
        user,
        client,
        channel: { id: "channel-123", ...(overrides.channel || {}) },
        deferred: false,
        replied: false,
        reply: jest.fn().mockResolvedValue(responseMessage),
        editReply: jest.fn().mockResolvedValue(responseMessage),
        followUp: jest.fn().mockResolvedValue(responseMessage),
        deleteReply: jest.fn().mockResolvedValue(undefined),
        options,
        ...(overrides.interaction || {})
    }

    return { interaction, user, client, responseMessage }
}

describe("reward command", () => {
    test("updates balance, schedules the next reward, and persists the change", async() => {
        const { interaction, user, client } = createMockInteraction()

        await rewardCommand.execute(interaction, client)

        expect(user.data.money).toBe(6500)
        expect(user.data.next_reward).toBeInstanceOf(Date)
        expect(client.dataHandler.resolveDBUser).toHaveBeenCalledWith(user)
        expect(client.dataHandler.updateUserData).toHaveBeenCalledWith(user.id, {
            money: user.data.money,
            gold: user.data.gold
        })
        expect(interaction.reply).toHaveBeenCalledTimes(1)
    })

    test("rejects redemption if reward is still on cooldown", async() => {
        const nextReward = new Date(Date.now() + 60 * 60 * 1000).toISOString()
        const { interaction, client } = createMockInteraction({
            user: { data: { next_reward: nextReward } }
        })

        await rewardCommand.execute(interaction, client)

        expect(client.dataHandler.updateUserData).not.toHaveBeenCalled()
        expect(interaction.reply).toHaveBeenCalledTimes(1)
        const replyPayload = interaction.reply.mock.calls[0][0]
        expect(replyPayload.embeds).toHaveLength(1)
    })
})

describe("profile command", () => {
    test("normalizes BIGINT-compatible string fields before rendering the profile", async() => {
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
                    win_probability_upgrade: "0",
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
