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

    const SORT_COLUMNS = {
        last_played: "COALESCE(u.`last_played`, '1970-01-01 00:00:00')",
        balance: "u.`money`",
        level: "u.`level`"
    }

    const clampNumber = (
        value,
        { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false } = {}
    ) => {
        if (value === null || value === undefined || value === "") {
            return null
        }

        const num = Number(value)
        if (!Number.isFinite(num)) return null
        const normalized = Math.min(Math.max(num, min), max)
        return integer ? Math.trunc(normalized) : normalized
    }

    const listUsers = async({
        page = 1,
        pageSize = 25,
        search,
        userIds,
        role,
        list,
        minLevel,
        maxLevel,
        minBalance,
        maxBalance,
        activityDays,
        sortBy = "last_played",
        sortDirection = "desc"
    } = {}) => {
        const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100)
        const normalizedPage = Math.max(Number(page) || 1, 1)
        const offset = (normalizedPage - 1) * normalizedPageSize

        const filters = []
        const params = []

        if (Array.isArray(userIds) && userIds.length > 0) {
            const placeholders = userIds.map(() => "?").join(", ")
            filters.push(`u.\`id\` IN (${placeholders})`)
            params.push(...userIds)
        } else if (typeof search === "string" && search.trim().length > 0) {
            filters.push("u.`id` LIKE ?")
            params.push(`%${search.trim()}%`)
        }

        const normalizedMinLevel = clampNumber(minLevel, { min: 0, max: 500, integer: true })
        const normalizedMaxLevel = clampNumber(maxLevel, { min: 0, max: 500, integer: true })

        if (normalizedMinLevel !== null) {
            filters.push("u.`level` >= ?")
            params.push(normalizedMinLevel)
        }

        if (normalizedMaxLevel !== null) {
            filters.push("u.`level` <= ?")
            params.push(normalizedMaxLevel)
        }

        const normalizedMinBalance = clampNumber(minBalance, { min: 0, max: Number.MAX_SAFE_INTEGER })
        const normalizedMaxBalance = clampNumber(maxBalance, { min: 0, max: Number.MAX_SAFE_INTEGER })

        if (normalizedMinBalance !== null) {
            filters.push("u.`money` >= ?")
            params.push(normalizedMinBalance)
        }

        if (normalizedMaxBalance !== null) {
            filters.push("u.`money` <= ?")
            params.push(normalizedMaxBalance)
        }

        const normalizedActivity = clampNumber(activityDays, { min: 1, max: 365, integer: true })
        if (normalizedActivity !== null) {
            filters.push("u.`last_played` IS NOT NULL")
            filters.push("u.`last_played` >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)")
            params.push(normalizedActivity)
        }

        if (typeof role === "string" && role.trim().length > 0) {
            filters.push("COALESCE(ua.`role`, 'USER') = ?")
            params.push(role.trim().toUpperCase())
        }

        if (list === "whitelisted") {
            filters.push("COALESCE(ua.`is_whitelisted`, 0) = 1")
        } else if (list === "blacklisted") {
            filters.push("COALESCE(ua.`is_blacklisted`, 0) = 1")
        } else if (list === "neutral") {
            filters.push("COALESCE(ua.`is_whitelisted`, 0) = 0")
            filters.push("COALESCE(ua.`is_blacklisted`, 0) = 0")
        }

        const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""

        const column = SORT_COLUMNS[sortBy] || SORT_COLUMNS.last_played
        const direction = sortDirection?.toUpperCase() === "ASC" ? "ASC" : "DESC"

        const baseQuery = `
            FROM \`users\` u
            LEFT JOIN \`user_access\` ua ON ua.\`user_id\` = u.\`id\`
        `

        try {
            const [rows] = await pool.query(
                `SELECT u.* ${baseQuery}
                ${whereClause}
                ORDER BY ${column} ${direction}
                LIMIT ? OFFSET ?`,
                [...params, normalizedPageSize, offset]
            )

            const [countRows] = await pool.query(
                `SELECT COUNT(*) as total ${baseQuery} ${whereClause}`,
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
            handleError(error, {
                operation: "listUsers",
                page: normalizedPage,
                pageSize: normalizedPageSize,
                search,
                userIds,
                role,
                list,
                minLevel,
                maxLevel,
                minBalance,
                maxBalance,
                activityDays,
                sortBy,
                sortDirection
            })
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
