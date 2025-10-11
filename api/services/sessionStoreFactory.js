const MySQLStoreFactory = require("express-mysql-session")
const logger = require("../../shared/logger")

const DEFAULT_SESSION_EXPIRATION = Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000
const DEFAULT_CHECK_INTERVAL = Number(process.env.SESSION_CLEANUP_INTERVAL_MS) || 15 * 60 * 1000

const createSessionStore = ({ session, pool }) => {
    const MySQLStore = MySQLStoreFactory(session)

    if (!pool) {
        logger.warn("No MySQL pool supplied for session store. Falling back to memory store.", {
            scope: "express"
        })
        return null
    }

    const store = new MySQLStore(
        {
            clearExpired: true,
            checkExpirationInterval: DEFAULT_CHECK_INTERVAL,
            expiration: DEFAULT_SESSION_EXPIRATION,
            endConnectionOnClose: false,
            schema: {
                tableName: "express_sessions"
            }
        },
        pool
    )

    logger.info("Using MySQL session store for API server", { scope: "express" })
    return store
}

module.exports = createSessionStore
