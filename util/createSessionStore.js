const DEFAULT_SESSION_EXPIRATION = Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000
const DEFAULT_CHECK_INTERVAL = Number(process.env.SESSION_CLEANUP_INTERVAL_MS) || 15 * 60 * 1000

const createSessionStore = ({ session, client, logger, driver = process.env.SESSION_STORE }) => {
    const normalizedDriver = (driver || "").toLowerCase()

    if (!normalizedDriver || normalizedDriver === "memory") {
        if (logger?.warn) {
            logger.warn("Using in-memory session store", {
                scope: "express",
                note: "Configure SESSION_STORE=mysql (or provide a custom store) for production deployments."
            })
        }
        return null
    }

    if (normalizedDriver === "mysql") {
        let MySQLStore
        try {
            MySQLStore = require("express-mysql-session")(session)
        } catch (error) {
            throw new Error("express-mysql-session is required for mysql-backed sessions. Install it with `npm install express-mysql-session`.")
        }

        if (!client?.connection) {
            throw new Error("MySQL session store requires an active MySQL connection pool.")
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
            client.connection
        )

        if (logger?.info) {
            logger.info("Using MySQL-backed session store", { scope: "express" })
        }

        return store
    }

    throw new Error(`Unsupported SESSION_STORE driver '${driver}'.`)
}

module.exports = createSessionStore
