const { normalizeUserExperience } = require("./experience")
const { error: logError } = require("./logger")

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

    const safeRollback = async(connection, context) => {
        try {
            await connection.rollback()
        } catch (rollbackError) {
            logError("Failed to rollback transaction", {
                scope: "mysql",
                ...context,
                message: rollbackError.message
            })
        }
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

        const connection = await pool.getConnection()
        const context = { operation: "createUserData", id }
        try {
            await connection.beginTransaction()
            await connection.query("INSERT INTO `users` (`id`) VALUES (?)", [id])
            const [results] = await connection.query("SELECT * FROM `users` WHERE `id` = ?", [id])
            await connection.commit()
            return mapUserRecord(results[0])
        } catch (error) {
            await safeRollback(connection, context)
            handleError(error, context)
        } finally {
            connection.release()
        }
    }

    const updateUserData = async(id, user) => {
        if (!id) throw new Error("User id is required.")

        const connection = await pool.getConnection()
        const context = { operation: "updateUserData", id }
        try {
            await connection.beginTransaction()
            await connection.query("UPDATE `users` SET ? WHERE `id` = ?", [user, id])
            const [results] = await connection.query("SELECT * FROM `users` WHERE `id` = ?", [id])
            await connection.commit()
            return mapUserRecord(results[0])
        } catch (error) {
            await safeRollback(connection, context)
            handleError(error, context)
        } finally {
            connection.release()
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
            next_reward: user.data.next_reward,
            last_played: user.data.last_played || new Date()
        }
    }

    return {
        getUserData,
        createUserData,
        updateUserData,
        resolveDBUser
    }
}

module.exports = createDataHandler
