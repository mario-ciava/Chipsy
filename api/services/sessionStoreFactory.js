const MySQLStoreFactory = require("express-mysql-session")
const logger = require("../../shared/logger")
const { sessions: sessionConfig = {} } = require("../../config")

const DEFAULT_SESSION_EXPIRATION = Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000
const DEFAULT_CHECK_INTERVAL = Number(process.env.SESSION_CLEANUP_INTERVAL_MS) || 15 * 60 * 1000

const DEFAULT_RESILIENCE = Object.freeze({
    fallbackEnabled: true,
    recoveryDelayMs: 15000,
    logThrottleMs: 10000
})

const PROXIED_METHODS = ["get", "set", "destroy", "touch", "length", "clear", "ids", "all"]

const buildResilienceOptions = () => ({
    fallbackEnabled: sessionConfig?.fallbackEnabled !== false,
    recoveryDelayMs: Number(sessionConfig?.recoveryDelayMs) || DEFAULT_RESILIENCE.recoveryDelayMs,
    logThrottleMs: Number(sessionConfig?.logThrottleMs) || DEFAULT_RESILIENCE.logThrottleMs
})

const formatLogContext = (operation, error) => ({
    scope: "express",
    operation,
    message: error?.message || "Unknown session store failure"
})

const createResilientStore = ({ session, mysqlStore }) => {
    const MemoryStore = session.MemoryStore
    const fallbackStore = new MemoryStore()
    const resilience = buildResilienceOptions()

    if (!mysqlStore) {
        logger.warn("MySQL session store unavailable. Using in-memory fallback only.", {
            scope: "express"
        })
        return fallbackStore
    }

    class ResilientSessionStore extends session.Store {
        constructor() {
            super()
            this.mysqlStore = mysqlStore
            this.fallbackStore = fallbackStore
            this.resilience = resilience
            this.nextRetryAt = 0
            this.lastLogAt = 0

            if (this.mysqlStore && this.resilience.fallbackEnabled && typeof this.mysqlStore.on === "function") {
                this.mysqlStore.on("error", (error) => {
                    this.markFailure(error, "store-error")
                })
            }
        }

        shouldUsePrimary() {
            if (!this.mysqlStore) {
                return false
            }
            if (!this.resilience.fallbackEnabled) {
                return true
            }
            return Date.now() >= this.nextRetryAt
        }

        markFailure(error, operation) {
            if (!this.resilience.fallbackEnabled) {
                return
            }
            this.nextRetryAt = Date.now() + this.resilience.recoveryDelayMs
            const now = Date.now()
            if (now - this.lastLogAt >= this.resilience.logThrottleMs) {
                logger.warn("Session store degraded to memory fallback", formatLogContext(operation, error))
                this.lastLogAt = now
            }
        }

        runWithStore(store, methodName, baseArgs, callback, allowFallback) {
            const args = baseArgs.slice()
            const target = store || this.fallbackStore
            const executor = typeof target?.[methodName] === "function" ? target[methodName].bind(target) : null

            if (callback) {
                args.push((err, ...results) => {
                    if (
                        err
                        && allowFallback
                        && target === this.mysqlStore
                        && this.resilience.fallbackEnabled
                    ) {
                        this.markFailure(err, methodName)
                        return this.runWithStore(this.fallbackStore, methodName, baseArgs, callback, false)
                    }
                    return callback(err, ...results)
                })
            }

            if (!executor) {
                if (callback) {
                    callback(new Error(`Session store missing method: ${methodName}`))
                }
                return
            }

            try {
                return executor(...args)
            } catch (error) {
                if (
                    allowFallback
                    && target === this.mysqlStore
                    && this.resilience.fallbackEnabled
                ) {
                    this.markFailure(error, methodName)
                    return this.runWithStore(this.fallbackStore, methodName, baseArgs, callback, false)
                }
                if (callback) {
                    callback(error)
                } else {
                    throw error
                }
            }
        }
    }

    ResilientSessionStore.prototype.execute = function execute(methodName, ...rawArgs) {
        const callback = typeof rawArgs[rawArgs.length - 1] === "function" ? rawArgs.pop() : undefined
        const baseArgs = rawArgs
        const usePrimary = this.shouldUsePrimary()
        const initialStore = usePrimary ? this.mysqlStore : this.fallbackStore
        return this.runWithStore(initialStore, methodName, baseArgs, callback, usePrimary)
    }

    for (const methodName of PROXIED_METHODS) {
        ResilientSessionStore.prototype[methodName] = function proxiedMethod(...args) {
            return this.execute(methodName, ...args)
        }
    }

    logger.info("Using resilient MySQL session store with memory fallback", {
        scope: "express",
        fallbackEnabled: resilience.fallbackEnabled,
        recoveryDelayMs: resilience.recoveryDelayMs
    })

    return new ResilientSessionStore()
}

const createSessionStore = ({ session, pool }) => {
    const MySQLStore = MySQLStoreFactory(session)
    const mysqlStore = pool
        ? new MySQLStore(
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
        : null

    return createResilientStore({ session, mysqlStore })
}

module.exports = createSessionStore
module.exports.createResilientStore = createResilientStore
