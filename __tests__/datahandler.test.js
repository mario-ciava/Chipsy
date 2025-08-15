const createDataHandler = require("../util/datahandler")
const createSetData = require("../util/createSetData")
const Game = require("../structure/game")
const { calculateRequiredExp, BASE_REQUIRED_EXP } = require("../util/experience")

const createMockConnection = (initialRows = []) => {
    const data = new Map()
    initialRows.forEach((row) => {
        data.set(row.id, { ...row })
    })

    const query = jest.fn((sql, params, callback) => {
        const invoke = (err, result) => callback(err, result)

        if (sql.startsWith("SELECT * FROM `users` WHERE `id` = ?")) {
            const [id] = Array.isArray(params) ? params : [params]
            const row = data.get(id)
            const result = row ? [{ ...row }] : []
            return setImmediate(() => invoke(null, result))
        }

        if (sql.startsWith("INSERT INTO `users` SET `id` = ?")) {
            const [id] = Array.isArray(params) ? params : [params]
            const defaults = {
                id,
                money: 5000,
                gold: 1,
                current_exp: 0,
                required_exp: BASE_REQUIRED_EXP,
                level: 0,
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
            data.set(id, defaults)
            return setImmediate(() => invoke(null, { affectedRows: 1 }))
        }

        if (sql.startsWith("UPDATE `users` SET ? WHERE `id` = ?")) {
            const [payload, id] = params
            const existing = data.get(id) || { id }
            data.set(id, { ...existing, ...payload })
            return setImmediate(() => invoke(null, { affectedRows: 1 }))
        }

        throw new Error(`Unsupported query in mock: ${sql}`)
    })

    return { query, data }
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
                required_exp: BASE_REQUIRED_EXP,
                level: 0,
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
        expect(persisted.level).toBe(1)
        expect(persisted.current_exp).toBeGreaterThanOrEqual(0)
        expect(persisted.required_exp).toBe(calculateRequiredExp(1))
        expect(persisted.money).toBeGreaterThan(5000)
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
})
