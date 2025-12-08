jest.mock("discord.js", () => {
    class MockEmbed {
        constructor() {
            this.setColor = jest.fn(() => this)
            this.addFields = jest.fn(() => this)
            this.setFooter = jest.fn(() => this)
            this.setThumbnail = jest.fn(() => this)
            this.setDescription = jest.fn(() => this)
            this.setTitle = jest.fn(() => this)
            this.setImage = jest.fn(() => this)
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
    }

    class MockAttachmentBuilder {
        constructor(buffer, meta) {
            this.buffer = buffer
            this.meta = meta
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
        ButtonBuilder: MockButtonBuilder,
        ActionRowBuilder: MockActionRowBuilder,
        AttachmentBuilder: MockAttachmentBuilder,
        StringSelectMenuBuilder: MockStringSelectMenuBuilder,
        ModalBuilder: MockModalBuilder,
        TextInputBuilder: MockTextInputBuilder,
        TextInputStyle: { Short: 1, Paragraph: 2 },
        ButtonStyle: {
            Primary: 1,
            Secondary: 2,
            Success: 3,
            Danger: 4
        },
        MessageFlags: { Ephemeral: 1 << 6 },
        Colors: {
            Red: "#ff0000",
            Green: "#00ff00",
            Gold: "#ffd700",
            Aqua: "#00ffff",
            Orange: "#ffa500",
            Purple: "#800080",
            Yellow: "#ffff00",
            LuminousVividPink: "#ff00ff"
        }
    }
})

jest.mock("../bot/utils/helpers", () => ({
    sleep: jest.fn().mockResolvedValue(undefined)
}))

jest.mock("../shared/features.js", () => ({
    applyUpgrades: jest.fn(() => 0),
    getLevelReward: jest.fn(() => 0)
}))

jest.mock("../bot/rendering/blackjackTableRenderer", () => ({
    renderCardTable: jest.fn(async() => Buffer.from("image")),
    createBlackjackTableState: jest.fn((state) => state)
}))

jest.mock("../bot/utils/logger", () => {
    const logAndSuppress = jest.fn(() => jest.fn())
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        logAndSuppress
    }
})

jest.mock("../config", () => ({
    blackjack: {
        deckCount: { default: 1, allowedRange: { min: 1, max: 8 } },
        reshuffleThreshold: { default: 8, allowedRange: { min: 4, max: 52 } },
        maxPlayersDefault: { default: 5, allowedRange: { min: 1, max: 7 } },
        minPlayers: { default: 1, allowedRange: { min: 1, max: 7 } },
        lobbyTimeout: { default: 1000, allowedRange: { min: 100, max: 10_000 } },
        betsTimeout: { default: 100, allowedRange: { min: 50, max: 2000 } },
        actionTimeout: { default: 100, allowedRange: { min: 50, max: 2000 } },
        modalTimeout: { default: 100, allowedRange: { min: 50, max: 2000 } },
        autobetShortTimeout: { default: 50, allowedRange: { min: 25, max: 500 } },
        timelineMaxEntries: { default: 10, allowedRange: { min: 5, max: 50 } },
        timelinePreview: { default: 5, allowedRange: { min: 2, max: 20 } }
    },
    delays: {
        short: { default: 0, allowedRange: { min: 0, max: 1000 } },
        medium: { default: 0, allowedRange: { min: 0, max: 1000 } },
        long: { default: 0, allowedRange: { min: 0, max: 1000 } }
    },
    cards: {
        suits: ["S", "H", "D", "C"],
        ranks: ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
    },
    constants: {
        experience: {
            baseRequiredExp: 100
        }
    },
    progression: {
        startingLevel: 1
    }
}))

const BlackJack = require("../bot/games/blackjack/blackjackGame")

const createMockChannel = () => ({
    id: "channel-123",
    send: jest.fn().mockResolvedValue({
        edit: jest.fn().mockResolvedValue(undefined),
        components: [],
        embeds: [],
        createMessageComponentCollector: jest.fn(() => ({
            on: jest.fn(),
            stop: jest.fn()
        }))
    }),
    createMessageComponentCollector: jest.fn(() => ({
        on: jest.fn(),
        stop: jest.fn()
    })),
    setRateLimitPerUser: jest.fn().mockResolvedValue(undefined),
    manageable: false
})

const createTestGame = () => {
    const channel = createMockChannel()
    const dataHandler = {
        updateUserData: jest.fn().mockResolvedValue(undefined),
        resolveDBUser: jest.fn((player) => ({
            money: player?.data?.money ?? 0,
            gold: player?.data?.gold ?? 0
        }))
    }
    const client = {
        dataHandler,
        activeGames: new Set(),
        user: { displayAvatarURL: jest.fn(() => "https://bot/avatar.png") }
    }
    const info = {
        message: { channel, client },
        minBet: 50,
        minBuyIn: 100,
        maxBuyIn: 5000,
        maxPlayers: 5
    }
    const game = new BlackJack(info)
    game.playing = true
    game.PickRandom = jest.fn(async(items, amount) => {
        if (!Array.isArray(items)) return []
        return items.splice(0, amount)
    })
    jest.spyOn(game, "updateRoundProgressEmbed").mockResolvedValue()
    jest.spyOn(game, "updateDealerProgressEmbed").mockResolvedValue()
    jest.spyOn(game, "captureTableRender").mockResolvedValue(null)
    jest.spyOn(game, "CloseBetsMessage").mockResolvedValue()
    jest.spyOn(game, "SendMessage").mockResolvedValue({
        edit: jest.fn().mockResolvedValue(undefined),
        components: [],
        embeds: []
    })
    game.CheckExp = jest.fn().mockResolvedValue(undefined)
    return { game, channel, client, dataHandler }
}

const createHand = (cards, extra = {}) => ({
    cards: [...cards],
    value: extra.value ?? 0,
    pair: extra.pair ?? false,
    busted: extra.busted ?? false,
    BJ: extra.BJ ?? false,
    push: extra.push ?? false,
    bet: extra.bet ?? 200,
    display: [],
    fromSplitAce: extra.fromSplitAce ?? false,
    result: extra.result ?? null,
    payout: extra.payout ?? 0
})

const buildPlayer = (game, overrides = {}) => {
    const userData = {
        money: 10_000,
        gold: 1,
        current_exp: 0,
        required_exp: 100,
        level: 1,
        hands_played: 0,
        hands_won: 0,
        biggest_won: 0,
        biggest_bet: 0,
        withholding_upgrade: 0,
        reward_amount_upgrade: 0,
        reward_time_upgrade: 0,
        win_probability_upgrade: 0,
        next_reward: null,
        last_played: null,
        ...(overrides.data || {})
    }

    const baseUser = {
        id: overrides.id || `player-${Math.random().toString(16).slice(2)}`,
        tag: overrides.tag || "Player#0001",
        username: overrides.username || "Player",
        bot: false,
        client: game.client,
        displayAvatarURL: jest.fn(() => "https://avatar.png"),
        data: userData
    }

    const player = game.createPlayerSession(baseUser, overrides.stack ?? 5000)
    player.stack = overrides.stack ?? 5000
    player.buyInAmount = player.stack
    player.pendingBuyIn = 0
    player.newEntry = false
    player.status = {
        current: overrides.current ?? false,
        currentHand: overrides.currentHand ?? 0,
        insurance: { wager: 0, settled: false, ...(overrides.status?.insurance || {}) },
        won: { grossValue: 0, netValue: 0, expEarned: 0, ...(overrides.status?.won || {}) },
        infoMessage: null,
        ...(overrides.status || {})
    }
    player.bets = {
        initial: overrides.bet ?? game.minBet,
        total: overrides.bet ?? game.minBet,
        insurance: overrides.insurance ?? 0,
        ...(overrides.bets || {})
    }
    player.hands = overrides.hands ? overrides.hands.map((hand) => ({ ...hand, cards: [...hand.cards] })) : []
    return player
}

describe("BlackJack hand evaluation", () => {
    test("ComputeHandsValue detects blackjack hands and soft totals", async() => {
        const { game } = createTestGame()
        const player = buildPlayer(game, { bet: 200 })
        player.hands = [createHand(["AH", "TD"], { bet: 200 })]

        await game.ComputeHandsValue(player)

        expect(player.hands[0].value).toBe(21)
        expect(player.hands[0].BJ).toBe(true)

        player.hands[0].cards = ["AH", "6D", "AC"]
        player.hands[0].pair = false
        player.hands[0].BJ = false

        await game.ComputeHandsValue(player)

        expect(player.hands[0].value).toBe(18)
        expect(player.hands[0].busted).toBe(false)
    })
})

describe("BlackJack turn options", () => {
    test("GetAvailableOptions exposes split, double, and insurance when allowed", async() => {
        const { game } = createTestGame()
        const player = buildPlayer(game, { bet: 200, stack: 2000 })
        player.hands = [
            createHand(["8H", "8D"], { bet: 200, pair: true }),
            createHand(["AH", "7C"], { bet: 200, fromSplitAce: true })
        ]
        player.status.currentHand = 0
        player.bets.initial = 200
        game.dealer = { cards: ["AS", "??"], value: 0 }

        const baseOptions = await game.GetAvailableOptions(player, 0)
        const restrictedOptions = await game.GetAvailableOptions(player, 1)

        expect(baseOptions).toEqual(["stand", "hit", "double", "split", "insurance"])
        expect(restrictedOptions).toEqual(["stand"])
    })
})

describe("BlackJack timeline telemetry", () => {
    test("getTimelineSnapshot exposes the most recent entries with ISO timestamps", () => {
        const { game } = createTestGame()
        const base = new Date("2024-02-01T00:00:00.000Z").getTime()
        game.dealerTimeline = Array.from({ length: 7 }).map((_, index) => ({
            at: new Date(base + index * 1000),
            message: `Event ${index + 1}`
        }))

        const snapshot = game.getTimelineSnapshot()

        expect(snapshot).not.toBeNull()
        expect(Array.isArray(snapshot.entries)).toBe(true)
        expect(snapshot.entries).toHaveLength(5)
        expect(snapshot.entries[0]).toEqual({
            at: new Date(base + 2000).toISOString(),
            message: "Event 3"
        })
        expect(snapshot.entries[4]).toEqual({
            at: new Date(base + 6000).toISOString(),
            message: "Event 7"
        })
    })
})

describe("BlackJack player actions", () => {
    test("Action hit draws a card, records the bust, and hands off to the dealer when necessary", async() => {
        const { game } = createTestGame()
        const player = buildPlayer(game, { bet: 150, stack: 300 })
        player.status.current = true
        player.availableOptions = ["hit", "stand"]
        player.hands = [createHand(["8H", "7D"], { bet: 150 })]
        game.cards = ["9C", "5D"]
        game.inGamePlayers = [player]
        game.players = game.inGamePlayers
        const dealerActionSpy = jest.spyOn(game, "DealerAction").mockResolvedValue(undefined)

        await game.Action("hit", player, 0)

        expect(player.hands[0].cards).toHaveLength(3)
        expect(player.hands[0].busted).toBe(true)
        expect(player.availableOptions).toEqual([])
        const timelineMessages = (game.dealerTimeline || []).map((entry) => entry.message)
        expect(timelineMessages).toEqual(
            expect.arrayContaining([
                expect.stringContaining("hits"),
                expect.stringContaining("busts")
            ])
        )
        expect(dealerActionSpy).toHaveBeenCalledTimes(1)
    })

    test("Action stand keeps the same player active while advancing to the next hand", async() => {
        const { game } = createTestGame()
        const player = buildPlayer(game, { bet: 200, stack: 2000 })
        player.status.current = true
        player.status.currentHand = 0
        player.availableOptions = ["stand"]
        player.hands = [
            createHand(["9H", "7D"], { bet: 200 }),
            createHand(["6C", "8S"], { bet: 200 })
        ]
        game.inGamePlayers = [player]
        const nextSpy = jest.spyOn(game, "NextPlayer").mockResolvedValue(undefined)
        const dealerSpy = jest.spyOn(game, "DealerAction").mockResolvedValue(undefined)

        await game.Action("stand", player, 0)

        expect(player.status.currentHand).toBe(1)
        expect(player.status.current).toBe(true)
        expect(nextSpy).toHaveBeenCalledWith(player)
        expect(dealerSpy).not.toHaveBeenCalled()
    })

    test("Action stand hands the turn to the next player after the final hand", async() => {
        const { game } = createTestGame()
        const firstPlayer = buildPlayer(game, { id: "player-1", bet: 200, stack: 1500 })
        const secondPlayer = buildPlayer(game, { id: "player-2", bet: 200, stack: 1500 })
        firstPlayer.status.current = true
        firstPlayer.status.currentHand = 0
        firstPlayer.availableOptions = ["stand"]
        secondPlayer.status.current = false
        secondPlayer.status.currentHand = 0
        firstPlayer.hands = [createHand(["9H", "7D"], { bet: 200 })]
        secondPlayer.hands = [createHand(["8C", "8S"], { bet: 200 })]
        game.inGamePlayers = [firstPlayer, secondPlayer]
        game.players = game.inGamePlayers
        const nextSpy = jest.spyOn(game, "NextPlayer").mockResolvedValue(undefined)
        const dealerSpy = jest.spyOn(game, "DealerAction").mockResolvedValue(undefined)

        await game.Action("stand", firstPlayer, 0)

        expect(firstPlayer.status.current).toBe(false)
        expect(nextSpy).toHaveBeenCalledWith(secondPlayer)
        expect(dealerSpy).not.toHaveBeenCalled()
    })
})

describe("BlackJack dealer showdown", () => {
    test("DealerAction settles blackjack wins and pushes without taxing stacks", async() => {
        const { game, dataHandler } = createTestGame()
        const winner = buildPlayer(game, { id: "winner", bet: 200, stack: 0 })
        const pusher = buildPlayer(game, { id: "push", bet: 100, stack: 0 })
        winner.hands = [createHand(["AH", "TD"], { value: 21, BJ: true, bet: 200 })]
        pusher.hands = [createHand(["9C", "9D"], { value: 18, bet: 100 })]
        game.players = [winner, pusher]
        game.inGamePlayers = [winner, pusher]
        game.cards = ["2C", "5D"]
        game.dealer = {
            cards: ["9H", "7D"],
            value: 16,
            busted: false,
            BJ: false,
            display: []
        }
        game.handlePlayersOutOfFunds = jest.fn().mockResolvedValue({ removed: 0, endedGame: false })
        const stopSpy = jest.spyOn(game, "Stop").mockResolvedValue(undefined)
        const nextHandSpy = jest.spyOn(game, "NextHand").mockResolvedValue(undefined)

        await game.DealerAction()

        expect(game.dealer.cards.length).toBeGreaterThan(2)
        expect(winner.hands[0].result).toBe("win")
        expect(winner.hands[0].payout).toBe(300)
        expect(winner.status.won.grossValue).toBe(500)
        expect(winner.status.won.netValue).toBe(500)
        expect(winner.stack).toBe(500)
        expect(winner.data.hands_won).toBe(1)
        expect(winner.data.hands_played).toBe(1)

        expect(pusher.hands[0].result).toBe("push")
        expect(pusher.stack).toBe(100)
        expect(pusher.data.hands_won).toBe(0)
        expect(pusher.data.hands_played).toBe(1)

        expect(dataHandler.updateUserData).toHaveBeenCalledTimes(2)
        expect(game.handlePlayersOutOfFunds).not.toHaveBeenCalled()
        expect(nextHandSpy).toHaveBeenCalledTimes(1)
        expect(stopSpy).not.toHaveBeenCalled()
    })
})

describe("BlackJack lobby safety nets", () => {
    test("Stop waits for pending joins before refunding buy-ins", async() => {
        const { game, dataHandler } = createTestGame()
        const mockUser = {
            id: "player-safe",
            tag: "Player#SAFE",
            username: "Player",
            bot: false,
            client: game.client,
            displayAvatarURL: jest.fn(() => "https://avatar.png"),
            data: {
                money: 10_000,
                gold: 0,
                current_exp: 0,
                required_exp: 100,
                level: 1,
                hands_played: 0,
                hands_won: 0,
                biggest_won: 0,
                biggest_bet: 0,
                withholding_upgrade: 0,
                reward_amount_upgrade: 0,
                reward_time_upgrade: 0,
                win_probability_upgrade: 0,
                next_reward: null,
                last_played: null
            }
        }

        let resolveFirstUpdate
        const pendingUpdate = new Promise((resolve) => {
            resolveFirstUpdate = resolve
        })
        dataHandler.updateUserData
            .mockImplementationOnce(() => pendingUpdate)
            .mockResolvedValue(undefined)

        const joinPromise = game.AddPlayer(mockUser, { buyIn: 1000 })
        const stopPromise = game.Stop({ notify: false, reason: "canceled" })

        resolveFirstUpdate()
        await Promise.all([joinPromise, stopPromise])

        expect(dataHandler.updateUserData).toHaveBeenCalledTimes(2)
        expect(mockUser.data.money).toBe(10_000)
        expect(game.pendingJoins.size).toBe(0)
    })

    test("AddPlayer aborts with stopping reason if the table shuts down mid-join", async() => {
        const { game } = createTestGame()
        const mockUser = {
            id: "player-stop",
            tag: "Player#STOP",
            username: "Player",
            bot: false,
            client: game.client,
            displayAvatarURL: jest.fn(() => "https://avatar.png"),
            data: {
                money: 5_000,
                gold: 0,
                current_exp: 0,
                required_exp: 100,
                level: 1,
                hands_played: 0,
                hands_won: 0,
                biggest_won: 0,
                biggest_bet: 0,
                withholding_upgrade: 0,
                reward_amount_upgrade: 0,
                reward_time_upgrade: 0,
                win_probability_upgrade: 0,
                next_reward: null,
                last_played: null
            }
        }

        const joinPromise = game.AddPlayer(mockUser, { buyIn: 1000 })
        const stopPromise = game.Stop({ notify: false, reason: "canceled" })

        const [joinResult] = await Promise.all([joinPromise, stopPromise])

        expect(joinResult.ok).toBe(false)
        expect(joinResult.reason).toBe("stopping")
        expect(mockUser.data.money).toBe(5_000)
        expect(game.players.length).toBe(0)
    })

    test("Stop restores lobby buy-ins even if stack was zeroed prematurely", async() => {
        const { game } = createTestGame()
        const mockUser = {
            id: "player-lobby",
            tag: "Player#LOBBY",
            username: "Player",
            bot: false,
            client: game.client,
            displayAvatarURL: jest.fn(() => "https://avatar.png"),
            data: {
                money: 10_000,
                gold: 0,
                current_exp: 0,
                required_exp: 100,
                level: 1,
                hands_played: 0,
                hands_won: 0,
                biggest_won: 0,
                biggest_bet: 0,
                withholding_upgrade: 0,
                reward_amount_upgrade: 0,
                reward_time_upgrade: 0,
                win_probability_upgrade: 0,
                next_reward: null,
                last_played: null
            }
        }

        await game.AddPlayer(mockUser, { buyIn: 2_000 })
        const lobbyPlayer = game.players[0]
        lobbyPlayer.stack = 0
        lobbyPlayer.pendingBuyIn = 2_000
        lobbyPlayer.newEntry = true

        await game.Stop({ notify: false, reason: "canceled" })

        expect(mockUser.data.money).toBe(10_000)
    })
})
