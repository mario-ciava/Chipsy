jest.mock("discord.js", () => {
    class MockEmbed {
        constructor() {
            this.setColor = jest.fn(() => this)
            this.addFields = jest.fn(() => this)
            this.setFooter = jest.fn(() => this)
            this.setThumbnail = jest.fn(() => this)
        }
    }

    const SlashCommandBuilder = jest.fn().mockImplementation(() => ({
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis()
    }))

    const Colors = {
        Red: "#ff0000",
        Green: "#00ff00",
        Gold: "#ffd700",
        Aqua: "#00ffff",
        Orange: "#ffa500"
    }

    return {
        EmbedBuilder: MockEmbed,
        SlashCommandBuilder,
        Colors
    }
})

jest.mock("../structure/features.js", () => ({
    applyUpgrades: jest.fn((feature) => {
        if (feature === "reward-amount") return 1500
        if (feature === "reward-time") return 1
        return 0
    }),
    get: jest.fn(() => ({ max: 10 })),
    getCosts: jest.fn(() => ["100"])
}))

const rewardCommand = require("../commands/reward")
const profileCommand = require("../commands/profile")

const createMockMessage = (overrides = {}) => ({
    channel: {
        send: jest.fn().mockResolvedValue(undefined),
        ...(overrides.channel || {})
    },
    author: {
        id: "user-123",
        tag: "Tester#0001",
        displayAvatarURL: jest.fn().mockReturnValue("https://avatar"),
        data: {
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
            next_reward: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            last_played: new Date().toISOString(),
            ...(overrides.author?.data || {})
        },
        ...(overrides.author || {})
    },
    client: {
        dataHandler: {
            updateUserData: jest.fn().mockResolvedValue(undefined),
            resolveDBUser: jest.fn((user) => ({
                money: user.data.money,
                gold: user.data.gold
            }))
        },
        ...(overrides.client || {})
    }
})

describe("reward command", () => {
    test("updates balance and persists the change", async() => {
        const msg = createMockMessage()

        await rewardCommand.run({ message: msg })

        expect(msg.author.data.money).toBe(6500)
        expect(msg.client.dataHandler.resolveDBUser).toHaveBeenCalledWith(msg.author)
        expect(msg.client.dataHandler.updateUserData).toHaveBeenCalledWith(
            msg.author.id,
            { money: 6500, gold: 1 }
        )
        expect(msg.author.data.next_reward).toBeInstanceOf(Date)
        expect(msg.channel.send).toHaveBeenCalledTimes(1)
    })
})

describe("profile command", () => {
    test("normalizes string based BIGINT fields before rendering", async() => {
        const msg = createMockMessage({
            author: {
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

        await profileCommand.run({ message: msg })

        expect(typeof msg.author.data.money).toBe("number")
        expect(typeof msg.author.data.gold).toBe("number")
        expect(typeof msg.author.data.biggest_bet).toBe("number")
        expect(msg.channel.send).toHaveBeenCalledTimes(1)
    })
})
