const logger = require("../logger")

const withTransaction = async(pool, handler, context = {}) => {
    if (!pool || typeof pool.getConnection !== "function") {
        throw new Error("A valid MySQL pool is required to run a transaction")
    }

    const connection = await pool.getConnection()
    const metadata = { scope: "mysql", ...context }

    try {
        await connection.beginTransaction()
        const result = await handler(connection)
        await connection.commit()
        return result
    } catch (error) {
        try {
            await connection.rollback()
        } catch (rollbackError) {
            logger.error("Failed to rollback MySQL transaction", {
                ...metadata,
                message: rollbackError.message
            })
        }
        error.transactionContext = metadata
        throw error
    } finally {
        connection.release()
    }
}

module.exports = { withTransaction }
