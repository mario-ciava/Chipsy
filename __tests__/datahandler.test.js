jest.mock("../shared/database/ensureSchema", () => jest.fn().mockResolvedValue())

const createDataHandler = require("../shared/database/dataHandler")
const ensureSchema = require("../shared/database/ensureSchema")
const createSetData = require("../bot/utils/createSetData")
const Game = require("../bot/games/shared/baseGame")
const { DEFAULT_PLAYER_LEVEL, calculateRequiredExp, normalizeUserExperience } = require("../bot/utils/experience")

beforeEach(() => {
    ensureSchema.mockClear()
})

const createMockConnection = (initialRows = [], initialAccessRows = []) => {
    const startingRequiredExp = calculateRequiredExp(DEFAULT_PLAYER_LEVEL)
    const data = new Map()
    initialRows.forEach((row) => {
        data.set(row.id, { ...row })
    })

    const accessData = new Map()
    initialAccessRows.forEach((row) => {
        accessData.set(row.user_id, { ...row })
    })

    const executeQuery = async(sql, params = []) => {
        const parameters = Array.isArray(params) ? params : [params]

        if (sql.startsWith("SELECT * FROM `users` WHERE `id` = ?")) {
            const [id] = parameters
            const row = data.get(id)
            return [row ? [{ ...row }] : []]
        }

        if (sql.startsWith("INSERT INTO `users` (`id`) VALUES (?)")) {
            const [id] = parameters
            const defaults = {
                id,
                money: 5000,
                gold: 1,
                current_exp: 0,
                required_exp: startingRequiredExp,
                level: DEFAULT_PLAYER_LEVEL,
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
            data.set(id, defaults)
            return [{ affectedRows: 1 }]
        }

        if (sql.startsWith("UPDATE `users` SET ? WHERE `id` = ?")) {
            const [payload, id] = parameters
            const existing = data.get(id) || { id }
            data.set(id, { ...existing, ...payload })
            return [{ affectedRows: 1 }]
        }

        if (sql.startsWith("DELETE FROM `users` WHERE `id` = ?")) {
            const [id] = parameters
            data.delete(id)
            return [{ affectedRows: 1 }]
        }

        if (sql.startsWith("DELETE FROM `user_access` WHERE `user_id` = ?")) {
            const [id] = parameters
            accessData.delete(id)
            return [{ affectedRows: 1 }]
        }

        if (sql.includes("FROM `leaderboard_cache`")) {
            return [[]]
        }

        if (sql.startsWith("INSERT INTO `leaderboard_cache`")) {
            return [{ affectedRows: 1 }]
        }

        if (sql.startsWith("DELETE FROM `leaderboard_cache`")) {
            return [{ affectedRows: 1 }]
        }

        throw new Error(`Unsupported query in mock: ${sql}`)
    }

    const query = jest.fn((sql, params) => executeQuery(sql, params))

    const createConnection = () => ({
        beginTransaction: jest.fn().mockResolvedValue(),
        query: (sql, params) => executeQuery(sql, params),
        commit: jest.fn().mockResolvedValue(),
        rollback: jest.fn().mockResolvedValue(),
        release: jest.fn()
    })

    const getConnection = jest.fn(async() => createConnection())

    return { query, getConnection, data, accessData }
}

describe("data handler experience persistence", () => {
    test("createSetData normalizes legacy schema", async() => {
        const connection = createMockConnection([
            {
                id: "legacy-user",
                money: 5000,
                gold: 1,
                exp: 45,
                level: 2,
                hands_played: 0,
                hands_won: 0,
                biggest_won: 0,
                biggest_bet: 0,
                withholding_upgrade: 0,
                reward_amount_upgrade: 0,
                reward_time_upgrade: 0,
                next_reward: null,
                last_played: null
            }
        ])

        const dataHandler = createDataHandler(connection)
        const setData = createSetData(dataHandler)
        const user = { id: "legacy-user", data: {} }

        const result = await setData(user)
        expect(result.error).toBeNull()
        expect(result.created).toBe(false)
        expect(result.data.current_exp).toBe(45)
        expect(result.data.required_exp).toBe(calculateRequiredExp(2))
    })

    test("experience changes persist through resolveDBUser", async() => {
        const userId = "player-1"
        const connection = createMockConnection([
            {
                id: userId,
                money: 5000,
                gold: 1,
                current_exp: 95,
                required_exp: calculateRequiredExp(DEFAULT_PLAYER_LEVEL),
                level: DEFAULT_PLAYER_LEVEL,
                hands_played: 0,
                hands_won: 0,
                biggest_won: 0,
                biggest_bet: 0,
                withholding_upgrade: 0,
                reward_amount_upgrade: 0,
                reward_time_upgrade: 0,
                next_reward: null,
                last_played: null
            }
        ])

        const dataHandler = createDataHandler(connection)
        const setData = createSetData(dataHandler)
        const user = { id: userId, tag: "Player", displayAvatarURL: () => "", data: {} }
        const result = await setData(user)
        expect(result.error).toBeNull()

        class TestGame extends Game {
            constructor() {
                super({
                    message: {
                        channel: { send: jest.fn().mockResolvedValue(undefined) },
                        client: { dataHandler }
                    }
                })
            }

            NextLevelMessage() {
                return Promise.resolve()
            }
        }

        const game = new TestGame()
        user.status = { won: {} }
        await game.CheckExp(10, user)

        const payload = dataHandler.resolveDBUser(user)
        await dataHandler.updateUserData(userId, payload)

        const persisted = await dataHandler.getUserData(userId)
        expect(persisted.level).toBe(DEFAULT_PLAYER_LEVEL)
        expect(persisted.current_exp).toBeGreaterThanOrEqual(0)
        expect(persisted.required_exp).toBe(calculateRequiredExp(DEFAULT_PLAYER_LEVEL))
        expect(persisted.money).toBeGreaterThanOrEqual(5000)
    })

    test("resolveDBUser keeps shared data references in sync", () => {
        const connection = createMockConnection([])
        const dataHandler = createDataHandler(connection)
        const baseData = {
            money: 25_000,
            gold: 3,
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
            win_probability_upgrade: 0,
            next_reward: null,
            last_played: null
        }

        const discordUser = { id: "sync-user", data: { ...baseData } }
        const session = { id: discordUser.id, data: discordUser.data, user: discordUser }

        const payload = dataHandler.resolveDBUser(session)
        expect(payload.money).toBe(baseData.money)

        session.data.money = 123
        expect(discordUser.data.money).toBe(123)
    })

    test("getUserData converts BIGINT columns returned as strings", async() => {
        const userId = "string-values"
        const connection = createMockConnection([
            {
                id: userId,
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
                win_probability_upgrade: "1",
                next_reward: null,
                last_played: null
            }
        ])

        const dataHandler = createDataHandler(connection)
        const data = await dataHandler.getUserData(userId)

        expect(data.money).toBe(7500)
        expect(data.gold).toBe(3)
        expect(typeof data.money).toBe("number")
        expect(typeof data.gold).toBe("number")
        expect(typeof data.biggest_bet).toBe("number")
    })
})

describe("createSetData error handling", () => {
    test("returns handled error when getUserData fails", async() => {
        const error = new Error("connection lost")
        const dataHandler = {
            getUserData: jest.fn().mockRejectedValue(error),
            createUserData: jest.fn()
        }

        const setData = createSetData(dataHandler)
        const user = { id: "123" }

        const result = await setData(user)
        expect(result.data).toBeNull()
        expect(result.created).toBe(false)
        expect(result.error).toEqual({
            type: "database",
            message: "Failed to retrieve user data.",
            cause: error
        })
    })

    test("returns handled error when createUserData fails", async() => {
        const getUserData = jest.fn().mockResolvedValue(null)
        const creationError = new Error("insert failed")
        const createUserData = jest.fn().mockRejectedValue(creationError)

        const setData = createSetData({ getUserData, createUserData })
        const user = { id: "abc" }

        const result = await setData(user)
        expect(result.data).toBeNull()
        expect(result.created).toBe(false)
        expect(result.error).toEqual({
            type: "database",
            message: "Failed to create user data.",
            cause: creationError
        })
    })

    test("returns concurrent profile when duplicate entry occurs", async() => {
        const user = { id: "duplicate-user" }
        const storedProfile = {
            id: user.id,
            level: "1",
            current_exp: "50",
            required_exp: "150",
            money: "6000",
            gold: "2",
            hands_played: "5",
            hands_won: "3",
            biggest_won: "1000",
            biggest_bet: "500",
            withholding_upgrade: "1",
            reward_amount_upgrade: "0",
            reward_time_upgrade: "0",
            win_probability_upgrade: "0"
        }

        const duplicateError = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" })
        const createUserData = jest
            .fn()
            .mockResolvedValueOnce(storedProfile)
            .mockRejectedValueOnce(duplicateError)

        const getUserData = jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(storedProfile)

        const setData = createSetData({ getUserData, createUserData })

        const [firstResult, secondResult] = await Promise.all([setData(user), setData(user)])

        const normalizedProfile = normalizeUserExperience(storedProfile)

        expect(firstResult.error).toBeNull()
        expect(firstResult.created).toBe(true)
        expect(firstResult.data).toEqual(normalizedProfile)

        expect(secondResult.error).toBeNull()
        expect(secondResult.created).toBe(false)
        expect(secondResult.data).toEqual(normalizedProfile)

        expect(createUserData).toHaveBeenCalledTimes(2)
        expect(getUserData).toHaveBeenCalledTimes(3)
    })

})

describe("leaderboard queries", () => {
    test("filters private bankrolls by default", async() => {
        const cacheRow = {
            metric: "net-profit",
            user_id: "user-1",
            money: 5_000_000,
            gold: 5,
            current_exp: 0,
            required_exp: calculateRequiredExp(DEFAULT_PLAYER_LEVEL),
            level: DEFAULT_PLAYER_LEVEL,
            hands_played: 0,
            hands_won: 0,
            net_winnings: 0,
            score: 0,
            win_rate: 0,
            trend_direction: 0,
            bankroll_private: 0,
            last_played: null,
            join_date: new Date()
        }

        const pool = {
            query: jest.fn().mockResolvedValue([[cacheRow]])
        }

        const dataHandler = createDataHandler(pool)
        const result = await dataHandler.getLeaderboard({ limit: 5 })

        expect(pool.query).toHaveBeenCalledTimes(1)
        const executedQuery = pool.query.mock.calls[0][0]
        expect(executedQuery.includes("FROM `leaderboard_cache`")).toBe(true)
        expect(executedQuery.includes("COALESCE(`bankroll_private`, 0) = 0")).toBe(true)
        expect(result.meta.privacyFilterApplied).toBe(true)
    })

    test("repairs schema and retries when bankroll column is missing", async() => {
        const unknownColumnError = Object.assign(
            new Error("Unknown column 'bankroll_private' in 'field list'"),
            { code: "ER_BAD_FIELD_ERROR", errno: 1054 }
        )

        const pool = {
            query: jest.fn()
        }

        pool.query
            .mockRejectedValueOnce(unknownColumnError)
            .mockResolvedValueOnce([[{
                metric: "net-profit",
                user_id: "user-1",
                money: 7_500_000,
                gold: 3,
                current_exp: 0,
                required_exp: calculateRequiredExp(DEFAULT_PLAYER_LEVEL),
                level: DEFAULT_PLAYER_LEVEL,
                hands_played: 0,
                hands_won: 0,
                net_winnings: 0,
                score: 0,
                win_rate: 0,
                trend_direction: 0,
                bankroll_private: 0,
                last_played: null,
                join_date: new Date()
            }]])

        const dataHandler = createDataHandler(pool)
        const result = await dataHandler.getLeaderboard({ limit: 5 })

        expect(pool.query).toHaveBeenCalledTimes(2)
        expect(ensureSchema).toHaveBeenCalledWith(pool)
        expect(result.items[0].money).toBe(7_500_000)
    })

    test("net profit metric selects the persisted net winnings column when hydrating cache", async() => {
        const fallbackRow = {
            id: "user-1",
            money: 4_000,
            gold: 1,
            current_exp: 0,
            required_exp: calculateRequiredExp(DEFAULT_PLAYER_LEVEL),
            level: DEFAULT_PLAYER_LEVEL,
            hands_played: 0,
            hands_won: 0,
            net_winnings: 2_500,
            withholding_upgrade: 0,
            reward_amount_upgrade: 0,
            reward_time_upgrade: 0,
            win_probability_upgrade: 0,
            bankroll_private: 0,
            next_reward: null,
            last_played: null,
            join_date: new Date()
        }

        const connection = {
            beginTransaction: jest.fn(),
            query: jest.fn(),
            commit: jest.fn(),
            rollback: jest.fn(),
            release: jest.fn()
        }

        const pool = {
            query: jest.fn()
                .mockResolvedValueOnce([[]])
                .mockResolvedValueOnce([[fallbackRow]]),
            getConnection: jest.fn().mockResolvedValue(connection)
        }

        const dataHandler = createDataHandler(pool)
        await dataHandler.getLeaderboard({ metric: "net-profit", limit: 5 })

        const executedQuery = pool.query.mock.calls[1][0]
        expect(executedQuery.includes("COALESCE(u.`net_winnings`, 0) AS net_profit")).toBe(true)
    })
})
