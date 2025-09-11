const { normalizeUserExperience } = require("./experience")
const { error: logError } = require("./logger")
const { withTransaction } = require("./db/withTransaction")

const mapUserRecord = (record) => {
    if (!record) return null
    return normalizeUserExperience(record)
}

const createDataHandler = (pool) => {
    const handleError = (err, context) => {
        logError("Database operation failed", {
            scope: "mysql",
            ...context,
            message: err.message
        })
        throw err
    }

    const getUserData = async(id) => {
        if (!id) throw new Error("User id is required.")

        try {
            const [results] = await pool.query("SELECT * FROM `users` WHERE `id` = ?", [id])
            if (results.length > 0) return mapUserRecord(results[0])
            return null
        } catch (error) {
            handleError(error, { operation: "getUserData", id })
        }
    }

    const createUserData = async(id) => {
        if (!id) throw new Error("User id is required.")

        const context = { operation: "createUserData", id }
        try {
            return await withTransaction(pool, async(connection) => {
                await connection.query("INSERT INTO `users` (`id`) VALUES (?)", [id])
                const [results] = await connection.query("SELECT * FROM `users` WHERE `id` = ?", [id])
                return mapUserRecord(results[0])
            }, context)
        } catch (error) {
            handleError(error, context)
        }
    }

    const updateUserData = async(id, user) => {
        if (!id) throw new Error("User id is required.")

        const context = { operation: "updateUserData", id }
        try {
            return await withTransaction(pool, async(connection) => {
                await connection.query("UPDATE `users` SET ? WHERE `id` = ?", [user, id])
                const [results] = await connection.query("SELECT * FROM `users` WHERE `id` = ?", [id])
                return mapUserRecord(results[0])
            }, context)
        } catch (error) {
            handleError(error, context)
        }
    }

    const resolveDBUser = (user) => {
        if (!user || !user.data) throw new Error("User data is required to resolve the database payload.")
        const normalized = normalizeUserExperience(user.data)
        user.data = { ...user.data, ...normalized }

        return {
            money: user.data.money,
            gold: user.data.gold,
            current_exp: user.data.current_exp,
            required_exp: user.data.required_exp,
            level: user.data.level,
            hands_played: user.data.hands_played,
            hands_won: user.data.hands_won,
            biggest_won: user.data.biggest_won,
            biggest_bet: user.data.biggest_bet,
            withholding_upgrade: user.data.withholding_upgrade,
            reward_amount_upgrade: user.data.reward_amount_upgrade,
            reward_time_upgrade: user.data.reward_time_upgrade,
            bankroll_private: user.data.bankroll_private || 0,
            next_reward: user.data.next_reward,
            last_played: user.data.last_played || new Date(),
            join_date: user.data.join_date || new Date()
        }
    }

    const listUsers = async({ page = 1, pageSize = 25, search } = {}) => {
        const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100)
        const normalizedPage = Math.max(Number(page) || 1, 1)
        const offset = (normalizedPage - 1) * normalizedPageSize

        const filters = []
        const params = []

        if (typeof search === "string" && search.trim().length > 0) {
            filters.push("`id` LIKE ?")
            params.push(`%${search.trim()}%`)
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""

        try {
            const [rows] = await pool.query(
                `SELECT * FROM \`users\` ${whereClause}
                ORDER BY COALESCE(\`last_played\`, '1970-01-01 00:00:00') DESC
                LIMIT ? OFFSET ?`,
                [...params, normalizedPageSize, offset]
            )

            const [countRows] = await pool.query(
                `SELECT COUNT(*) as total FROM \`users\` ${whereClause}`,
                params
            )

            const total = countRows?.[0]?.total || 0
            const totalPages = total === 0 ? 1 : Math.ceil(total / normalizedPageSize)

            return {
                items: rows.map(mapUserRecord),
                pagination: {
                    page: normalizedPage,
                    pageSize: normalizedPageSize,
                    total,
                    totalPages
                }
            }
        } catch (error) {
            handleError(error, { operation: "listUsers", page: normalizedPage, pageSize: normalizedPageSize, search })
        }
    }

    return {
        getUserData,
        createUserData,
        updateUserData,
        resolveDBUser,
        listUsers
    }
}

module.exports = createDataHandler
