const { config: loadEnv } = require("dotenv")
const { z } = require("zod")

// Load environment variables once at startup
const result = loadEnv()
if (result?.error) {
    throw result.error
}

const envSchema = z.object({
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
    DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required."),
    DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required."),
    DISCORD_OWNER_ID: z.string().min(1, "DISCORD_OWNER_ID is required."),
    DISCORD_TEST_GUILD_ID: z.string().optional(),
    COMMAND_PREFIX: z.string().min(1, "COMMAND_PREFIX is required."),
    MYSQL_HOST: z.string().min(1, "MYSQL_HOST is required.").default("localhost"),
    MYSQL_PORT: z.coerce.number().int().positive("MYSQL_PORT must be a positive integer.").default(3306),
    MYSQL_DATABASE: z.string().min(1, "MYSQL_DATABASE is required.").default("app_data"),
    MYSQL_USER: z.string().optional(),
    MYSQL_PASSWORD: z.string().optional(),
    FRONTEND_REDIRECT_ORIGIN: z.string().optional(),
    BOT_DISPLAY_NAME: z.string().optional()
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
    console.error("\n❌ Configuration validation failed:")
    for (const issue of parsedEnv.error.issues) {
        const path = issue.path.join(".") || issue.code
        console.error(`   - ${path}: ${issue.message}`)
    }
    console.error("\nPlease check your .env file and ensure all required variables are set correctly.\n")
    process.exit(1)
}

const env = parsedEnv.data

const constants = {
    timeouts: {
        serverShutdown: 15000,
        mysqlShutdown: 10000,
        devRunnerShutdown: 10000,
        mysqlHealthcheck: 25000
    },
    retry: {
        mysql: {
            maxAttempts: 5,
            baseDelay: 250
        },
        childProcess: {
            maxRestarts: 5,
            maxDelay: 5000
        }
    },
    database: {
        pool: {
            connectionLimit: 10,
            queueLimit: 0,
            waitForConnections: true
        },
        defaultMoney: 5000,
        defaultUserStats: {
            gold: 1,
            hands_played: 0,
            hands_won: 0,
            biggest_won: 0,
            biggest_bet: 0,
            withholding_upgrade: 0,
            reward_amount_upgrade: 0,
            reward_time_upgrade: 0
        }
    },
    ports: {
        botApi: 8082,
        vueDev: 8080,
        vueLegacy: 8081,
        mysql: 3306,
        legacy: 3000
    },
    get urls() {
        return {
            botApiLocal: `http://localhost:${this.ports.botApi}`,
            vueDevLocal: `http://localhost:${this.ports.vueDev}`,
            vueLegacyLocal: `http://localhost:${this.ports.vueLegacy}`,
            legacyLocal: `http://localhost:${this.ports.legacy}`
        }
    },
    server: {
        get defaultPort() {
            return constants.ports.botApi
        },
        sessionMaxAge: 24 * 60 * 60 * 1000,
        tokenCacheTtlMs: 15 * 60 * 1000,
        tokenCacheMaxEntries: 500,
        hstsMaxAge: 31536000,
        rateLimiter: {
            windowMs: 15 * 60 * 1000,
            max: 1000
        },
        bodyLimit: "10mb"
    },
    logging: {
        maxFileSize: 5 * 1024 * 1024,
        maxFiles: 5
    },
    games: {
        playerActionTimeout: 30000,
        upgradeConfirmTimeout: 180000,
        texasHoldemTurnTimeout: 45000
    },
    development: {
        panelStartDelay: 1500,
        healthcheckInterval: 1000
    },
    experience: {
        baseRequiredExp: 100
    }
}

const upgradeDefinitions = {
    withholding: {
        id: "withholding",
        featureKey: "with-holding",
        dbField: "withholding_upgrade",
        name: "Withholding Tax",
        emoji: "💵",
        description: "Reduces the tax deducted from your winnings when you win a considerable amount of money.",
        details: "Withholding tax is **8x higher** in Blackjack games. Each upgrade level has **2.5x** the standard effect, making it particularly valuable for high-stakes players.",
        costs: {
            starting: 250000,
            increase: 1000
        },
        maxLevel: 10,
        effect: {
            strategy: "linear-subtract",
            base: 0.0003,
            perLevel: 0.00002,
            precision: 5,
            min: 0,
            formatPrefix: "-",
            format: (value) => `${(value * 100).toFixed(3)}%`
        },
        blackjackMultiplier: 8,
        effectMultiplier: 2.5
    },
    reward_amount: {
        id: "reward_amount",
        featureKey: "reward-amount",
        dbField: "reward_amount_upgrade",
        name: "Daily Reward Amount",
        emoji: "🏆",
        description: "Increases the amount of money you receive from your daily reward.",
        details: "Each level multiplies your reward amount by **1.5x**, allowing you to earn significantly more over time.",
        costs: {
            starting: 250000,
            increase: 1500
        },
        maxLevel: 10,
        effect: {
            strategy: "exponential",
            base: 25000,
            multiplier: 1.5,
            format: (value) => `+${Math.floor(value).toLocaleString()}$`
        }
    },
    reward_time: {
        id: "reward_time",
        featureKey: "reward-time",
        dbField: "reward_time_upgrade",
        name: "Daily Reward Cooldown",
        emoji: "⏳",
        description: "Decreases the time you need to wait before redeeming another daily reward.",
        details: "Each level reduces the cooldown by **0.5 hours**, down to a minimum of **1 hour** between rewards.",
        costs: {
            starting: 150000,
            increase: 1250
        },
        maxLevel: 5,
        effect: {
            strategy: "linear-subtract",
            base: 24,
            perLevel: 0.5,
            min: 1,
            format: (value) => `${value}h`
        }
    }
}

const clampLevel = (level, maxLevel) => {
    const numericLevel = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0
    return Math.min(numericLevel, maxLevel)
}

const calculateUpgradeCost = (upgradeId, level) => {
    const definition = upgradeDefinitions[upgradeId]
    if (!definition) return null

    const safeLevel = clampLevel(level, definition.maxLevel)
    const costs = [definition.costs.starting]

    for (let i = 0; i < definition.maxLevel; i++) {
        const last = costs[i]
        const next = last + parseInt(Math.sqrt(last) * definition.costs.increase, 10)
        costs.push(next)
    }

    return costs[safeLevel]
}

const getAllUpgradeCosts = (upgradeId, withSeparator = false) => {
    const definition = upgradeDefinitions[upgradeId]
    if (!definition) return null

    const costs = [definition.costs.starting]
    for (let i = 0; i < definition.maxLevel; i++) {
        const last = costs[i]
        const next = last + parseInt(Math.sqrt(last) * definition.costs.increase, 10)
        costs.push(next)
    }

    if (!withSeparator) {
        return costs
    }

    const setSeparator = require("../bot/utils/setSeparator")
    return costs.map(cost => setSeparator(cost))
}

const calculateUpgradeValue = (upgradeId, level) => {
    const definition = upgradeDefinitions[upgradeId]
    if (!definition) return null

    const safeLevel = clampLevel(level, definition.maxLevel)
    const effect = definition.effect

    if (effect.strategy === "exponential") {
        let result = effect.base
        for (let i = 0; i < safeLevel; i++) {
            result = parseInt(result * (effect.multiplier ?? 1), 10)
        }
        return result
    }

    let result = effect.base - (effect.perLevel ?? 0) * safeLevel
    if (typeof effect.precision === "number") {
        result = parseFloat(result.toFixed(effect.precision))
    }

    if (typeof effect.min === "number") {
        result = Math.max(effect.min, result)
    }

    return result
}

const getUpgrade = (upgradeId) => upgradeDefinitions[upgradeId] || null
const getAllUpgradeIds = () => Object.keys(upgradeDefinitions)
const getUpgradeByDbField = (dbField) => Object.values(upgradeDefinitions).find(def => def.dbField === dbField) || null

const buildProgressionUpgrades = () => {
    return Object.values(upgradeDefinitions).reduce((acc, definition) => {
        acc[definition.featureKey] = {
            baseValue: definition.effect.base,
            increment: definition.effect.strategy === "linear-subtract" ? definition.effect.perLevel : undefined,
            multiplier: definition.effect.strategy === "exponential" ? definition.effect.multiplier : undefined,
            startingCost: definition.costs.starting,
            costGrowth: definition.costs.increase,
            maxLevel: definition.maxLevel,
            strategy: definition.effect.strategy,
            precision: definition.effect.precision,
            minValue: definition.effect.min
        }
        return acc
    }, {})
}

const config = {
    env,
    discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        botToken: env.DISCORD_BOT_TOKEN,
        ownerId: env.DISCORD_OWNER_ID,
        testGuildId: env.DISCORD_TEST_GUILD_ID
    },
    bot: {
        prefix: env.COMMAND_PREFIX,
        enabled: true,
        displayName: env.BOT_DISPLAY_NAME || "Chipsy"
    },
    mysql: {
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        database: env.MYSQL_DATABASE,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD
    },
    web: {
        redirectOrigin: env.FRONTEND_REDIRECT_ORIGIN || constants.urls.botApiLocal
    },
    blackjack: {
        deckCount: {
            default: 6,
            allowedRange: { min: 1, max: 8 }
        },
        reshuffleThreshold: {
            default: 52,
            allowedRange: { min: 20, max: 104 }
        },
        maxPlayersDefault: {
            default: 7,
            allowedRange: { min: 1, max: 7 }
        },
        minPlayers: {
            default: 2,
            allowedRange: { min: 2, max: 7 }
        },
        lobbyTimeout: {
            default: 5 * 60 * 1000,
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 }
        },
        betsTimeout: {
            default: 45 * 1000,
            allowedRange: { min: 10 * 1000, max: 120 * 1000 }
        },
        actionTimeout: {
            default: 45 * 1000,
            allowedRange: { min: 15 * 1000, max: 120 * 1000 }
        },
        modalTimeout: {
            default: 25 * 1000,
            allowedRange: { min: 10 * 1000, max: 60 * 1000 }
        },
        autobetShortTimeout: {
            default: 3 * 1000,
            allowedRange: { min: 1 * 1000, max: 10 * 1000 }
        },
        timelineMaxEntries: {
            default: 30,
            allowedRange: { min: 10, max: 100 }
        }
    },
    texas: {
        actionTimeout: {
            default: 45 * 1000,
            allowedRange: { min: 15 * 1000, max: 120 * 1000 }
        },
        collectorTimeout: {
            default: 5 * 60 * 1000,
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 }
        },
        modalTimeout: {
            default: 60 * 1000,
            allowedRange: { min: 10 * 1000, max: 120 * 1000 }
        },
        nextHandDelay: {
            default: 8 * 1000,
            allowedRange: { min: 3 * 1000, max: 20 * 1000 }
        },
        minPlayers: {
            default: 2,
            allowedRange: { min: 2, max: 9 }
        },
        maxPlayers: {
            default: 9,
            allowedRange: { min: 2, max: 9 }
        },
        minBet: {
            default: 100,
            allowedRange: { min: 10, max: 1000 }
        },
        maxBuyIn: {
            default: 10000,
            allowedRange: { min: 100, max: 100000 }
        }
    },
    lobby: {
        debounceDelay: {
            default: 350,
            allowedRange: { min: 100, max: 1000 }
        },
        collectorTimeout: {
            default: 5 * 60 * 1000,
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 }
        },
        autoStartDelay: {
            default: 60 * 1000,
            allowedRange: { min: 10 * 1000, max: 10 * 60 * 1000 }
        },
        modalTimeout: {
            default: 60 * 1000,
            allowedRange: { min: 15 * 1000, max: 120 * 1000 }
        }
    },
    delays: {
        short: {
            default: 2000,
            allowedRange: { min: 500, max: 5000 }
        },
        medium: {
            default: 3500,
            allowedRange: { min: 1000, max: 10000 }
        },
        long: {
            default: 5000,
            allowedRange: { min: 2000, max: 15000 }
        }
    },
    cards: {
        suits: ["S", "C", "H", "D"],
        ranks: ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
    },
    progression: {
        classes: [
            { name: "Bronze III", threshold: 50_000 },
            { name: "Bronze II", threshold: 100_000 },
            { name: "Bronze I", threshold: 150_000 },
            { name: "Silver III", threshold: 250_000 },
            { name: "Silver II", threshold: 500_000 },
            { name: "Silver I", threshold: 750_000 },
            { name: "Gold III", threshold: 1_500_000 },
            { name: "Gold II", threshold: 5_000_000 },
            { name: "Gold I", threshold: 20_000_000 },
            { name: "Platinum III", threshold: 75_000_000 },
            { name: "Platinum II", threshold: 150_000_000 },
            { name: "Platinum I", threshold: 300_000_000 },
            { name: "Diamond III", threshold: 500_000_000 },
            { name: "Diamond II", threshold: 750_000_000 },
            { name: "Diamond I", threshold: 1_000_000_000 }
        ],
        levelReward: {
            base: 5000,
            multiplier: 16,
            adjustmentDivisor: 100
        },
        upgrades: buildProgressionUpgrades()
    }
}

const upgradeToolkit = {
    definitions: upgradeDefinitions,
    calculateCost: calculateUpgradeCost,
    getAllCosts: getAllUpgradeCosts,
    calculateValue: calculateUpgradeValue,
    get: getUpgrade,
    getAllIds: getAllUpgradeIds,
    getByDbField: getUpgradeByDbField
}

module.exports = {
    ...config,
    constants,
    upgrades: upgradeToolkit
}
