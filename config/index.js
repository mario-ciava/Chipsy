const path = require("path")
const fs = require("fs")
const { config: loadEnv } = require("dotenv")
const { z } = require("zod")
const uiTheme = require("./uiTheme")
const marketingContent = require("./marketingContent")
const userDetailLayout = require("./userDetailLayout")

const projectRoot = path.resolve(__dirname, "..")

const loadEnvFile = (filename, { override = true } = {}) => {
    const filePath = path.join(projectRoot, filename)
    if (!fs.existsSync(filePath)) {
        return null
    }

    const shouldProtectRuntimeEnv = process.env.DOCKER_ENV === "true"
    const result = loadEnv({ path: filePath, override: shouldProtectRuntimeEnv ? false : override })
    if (result?.error) {
        throw result.error
    }

    return { path: filePath }
}

const resolveEnvTarget = () => {
    const explicit = (process.env.CHIPSY_ENV || "").toLowerCase()
    if (explicit === "local" || explicit === "vps") {
        return explicit
    }
    if (process.env.NODE_ENV === "production" || process.env.DOCKER_ENV === "true") {
        return "vps"
    }
    return "local"
}

const baseEnv = loadEnvFile(".env", { override: false })
const activeEnvTarget = resolveEnvTarget()
const variantEnv = loadEnvFile(`.env.${activeEnvTarget}`)

if (!baseEnv && !variantEnv) {
    const fallback = loadEnv()
    if (fallback?.error && fallback.error.code !== "ENOENT") {
        throw fallback.error
    }
}

process.env.CHIPSY_ENV = activeEnvTarget

const envSchema = z.object({
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
    DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required."),
    DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required."),
    DISCORD_OWNER_ID: z.string().min(1, "DISCORD_OWNER_ID is required."),
    DISCORD_TEST_GUILD_ID: z.string().optional(),
    MYSQL_HOST: z.string().min(1, "MYSQL_HOST is required.").default("localhost"),
    MYSQL_PORT: z.coerce.number().int().positive("MYSQL_PORT must be a positive integer.").default(3306),
    MYSQL_DATABASE: z.string().min(1, "MYSQL_DATABASE is required.").default("app_data"),
    MYSQL_USER: z.string().optional(),
    MYSQL_PASSWORD: z.string().optional(),
    FRONTEND_REDIRECT_ORIGIN: z.string().optional(),
    BOT_DISPLAY_NAME: z.string().optional(),
    HEALTH_CHECK_TOKEN: z.string().optional(),
    INTERNAL_API_TOKEN: z.string().optional(),
    BOT_RPC_TOKEN: z.string().optional(),
    BOT_RPC_BASE_URL: z.string().optional(),
    BOT_INTERNAL_PORT: z.coerce.number().int().positive().optional(),
    BOT_RPC_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    BOT_RPC_POLL_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    INTERNAL_API_ENABLED: z.string().optional(),
    BOT_INTERNAL_HOST: z.string().optional(),
    BOT_INTERNAL_PATH: z.string().optional(),
    BOT_SERVICE_HOST: z.string().optional()
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

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === "") {
        return fallback
    }
    if (typeof value === "boolean") {
        return value
    }
    const normalized = String(value).trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
        return true
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
        return false
    }
    return fallback
}

const parseCsvList = (value, fallback = []) => {
    if (!value || typeof value !== "string") {
        return Array.isArray(fallback) ? fallback : []
    }
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
}

const securityConfig = Object.freeze({
    enforceHttps: parseBoolean(process.env.ENFORCE_HTTPS, process.env.NODE_ENV === "production"),
    allowHttpHosts: parseCsvList(process.env.SECURITY_ALLOW_HTTP_HOSTS, ["localhost", "127.0.0.1"]),
    healthCheckToken: env.HEALTH_CHECK_TOKEN || null
})

const internalApiConfig = Object.freeze({
    enabled: parseBoolean(process.env.INTERNAL_API_ENABLED, true),
    host: process.env.BOT_INTERNAL_HOST || "0.0.0.0",
    port: Number(process.env.BOT_INTERNAL_PORT) || 7310,
    path: process.env.BOT_INTERNAL_PATH || "/internal",
    token: process.env.INTERNAL_API_TOKEN || process.env.BOT_RPC_TOKEN || null
})

const resolveBotRpcBaseUrl = () => {
    if (process.env.BOT_RPC_BASE_URL) {
        return process.env.BOT_RPC_BASE_URL
    }
    const serviceHost = process.env.BOT_SERVICE_HOST || "bot"
    const defaultUrl = `http://${serviceHost}:${internalApiConfig.port}${internalApiConfig.path}`
    const localUrl = `http://localhost:${internalApiConfig.port}${internalApiConfig.path}`
    return process.env.CHIPSY_ENV === "local" ? localUrl : defaultUrl
}

const botRpcConfig = Object.freeze({
    baseUrl: resolveBotRpcBaseUrl(),
    token: process.env.BOT_RPC_TOKEN || internalApiConfig.token,
    timeoutMs: Number(process.env.BOT_RPC_TIMEOUT_MS) || 8000,
    pollIntervalMs: Number(process.env.BOT_RPC_POLL_INTERVAL_MS) || 5000
})

const clampChannel = (value) => {
    if (!Number.isFinite(value)) {
        return 0
    }
    return Math.min(255, Math.max(0, Math.round(value)))
}

const parseHexColor = (hex) => {
    if (typeof hex !== "string") {
        return null
    }
    const match = hex.trim().match(/^#?([0-9a-f]{6})$/i)
    if (!match) {
        return null
    }
    const value = match[1]
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    }
}

const rgbToHex = (r, g, b) => {
    const toHex = (channel) => clampChannel(channel).toString(16).padStart(2, "0")
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const mixHex = (color, target, ratio = 0.15) => {
    const sourceRgb = parseHexColor(color)
    const targetRgb = parseHexColor(target)
    if (!sourceRgb || !targetRgb) {
        return color
    }
    const blend = Math.min(1, Math.max(0, ratio))
    const mixChannel = (source, destination) => source + (destination - source) * blend
    return rgbToHex(
        mixChannel(sourceRgb.r, targetRgb.r),
        mixChannel(sourceRgb.g, targetRgb.g),
        mixChannel(sourceRgb.b, targetRgb.b)
    )
}

const lightenHex = (color, ratio = 0.15) => mixHex(color, "#ffffff", ratio)
const darkenHex = (color, ratio = 0.15) => mixHex(color, "#000000", ratio)

const roleBadges = Object.freeze({
    master: Object.freeze({
        start: lightenHex(uiTheme.colors.warning, 0.18),
        end: darkenHex(uiTheme.colors.warning, 0.1),
        text: "#0f172a"
    }),
    admin: Object.freeze({
        start: lightenHex(uiTheme.colors.highlight, 0.1),
        end: darkenHex(uiTheme.colors.accent, 0.1),
        text: uiTheme.colors.primary
    }),
    moderator: Object.freeze({
        start: lightenHex(uiTheme.colors.success, 0.15),
        end: darkenHex(uiTheme.colors.success, 0.12),
        text: "#052e16"
    })
})

const designTokens = Object.freeze({
    theme: uiTheme,
    colors: uiTheme.colors,
    fonts: uiTheme.fonts,
    layout: uiTheme.layout,
    radii: uiTheme.radii,
    effects: uiTheme.effects,
    spacing: Object.freeze({
        shellPaddingX: 32,
        shellPaddingY: 24,
        sectionGap: uiTheme.layout.cardGap,
        stackGap: 16,
        cardPadding: 24
    }),
    typography: Object.freeze({
        heading: {
            weight: 600,
            tracking: -0.02,
            lineHeight: 1.2
        },
        body: {
            size: 16,
            lineHeight: 1.5
        },
        label: {
            size: 12,
            letterSpacing: 0.18
        }
    }),
    roleBadges
})

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
    messages: {
        sessionExpired: "401: Session expired. Please log in again."
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

    const setSeparator = require("../shared/utils/setSeparator")
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
        enabled: true,
        displayName: env.BOT_DISPLAY_NAME || "Chipsy",
        commands: {
            watch: true,
            reloadDebounceMs: 750,
            syncOnChange: true,
            syncDebounceMs: 4000
        }
    },
    mysql: {
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        database: env.MYSQL_DATABASE,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD
    },
    web: {
        redirectOrigin: env.FRONTEND_REDIRECT_ORIGIN || constants.urls.vueDevLocal
    },
    internalApi: internalApiConfig,
    botRpc: botRpcConfig,
    panel: {
        http: {
            timeoutMs: 15000
        },
        toggles: {
            cooldownMs: 15000,
            holdDurationMs: 3000
        },
        status: {
            refreshIntervalMs: 30000
        },
        guilds: {
            waitForJoin: {
                pollDelayMs: 1500,
                maxAttemptsWithTarget: 5,
                maxAttemptsWithoutTarget: 3
            },
            fetch: {
                cacheTtlMs: 5000,
                maxEntries: 250,
                retryAfterFloorMs: 7000,
                forceRefreshCooldownMs: 4000,
                liveFetchDebounceMs: 1000
            }
        },
        dropdown: {
            background: "rgba(15, 23, 42, 0.95)",
            border: "rgba(148, 163, 184, 0.35)",
            optionHover: "rgba(99, 102, 241, 0.35)",
            optionActive: "rgba(124, 58, 237, 0.45)",
            optionText: "#f8fafc"
        },
        userStats: {
            densityModes: [
                { label: "Comfort", value: "comfortable" },
                { label: "Compact", value: "compact" }
            ],
            kpis: {
                maxCards: 5,
                veteranLevelThreshold: 40,
                vipBalanceThreshold: 250000,
                recentActivityWindowDays: 14
            }
        },
        userDetails: userDetailLayout,
        users: {
            profiles: {
                autoProvisionOnLogin: true,
                provisionRetryLimit: 2
            },
            overrides: {
                masterSelfEditEnabled: true
            }
        }
    },
    marketing: marketingContent,
    security: securityConfig,
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
        startingLevel: 1,
        classes: [
            { name: "Rookie I", threshold: 0 },
            { name: "Rookie II", threshold: 25_000 },
            { name: "Rookie III", threshold: 50_000 },

            { name: "Bronze I", threshold: 100_000 },
            { name: "Bronze II", threshold: 200_000 },
            { name: "Bronze III", threshold: 300_000 },
            { name: "Bronze IV", threshold: 400_000 },
            { name: "Bronze V", threshold: 500_000 },

            { name: "Silver I", threshold: 750_000 },
            { name: "Silver II", threshold: 1_000_000 },
            { name: "Silver III", threshold: 2_000_000 },
            { name: "Silver IV", threshold: 3_000_000 },
            { name: "Silver V", threshold: 5_000_000 },

            { name: "Gold I", threshold: 7_500_000 },
            { name: "Gold II", threshold: 10_000_000 },
            { name: "Gold III", threshold: 20_000_000 },
            { name: "Gold IV", threshold: 30_000_000 },
            { name: "Gold V", threshold: 50_000_000 },

            { name: "Diamond I", threshold: 75_000_000 },
            { name: "Diamond II", threshold: 100_000_000 },
            { name: "Diamond III", threshold: 150_000_000 },
            { name: "Diamond IV", threshold: 200_000_000 },
            { name: "Diamond V", threshold: 300_000_000 },

            { name: "Master I", threshold: 500_000_000 },
            { name: "Master II", threshold: 750_000_000 },
            { name: "Master III", threshold: 1_000_000_000 },
            { name: "Master IV", threshold: 2_000_000_000 },
            { name: "Master V", threshold: 3_000_000_000 },

            { name: "Legend", threshold: 5_000_000_000 }
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
    upgrades: upgradeToolkit,
    uiTheme,
    designTokens,
    userDetailLayout
}
