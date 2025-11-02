const { normalizeUserExperience } = require("../experience")
const { error: logError } = require("../logger")
const { withTransaction } = require("../db/withTransaction")
const ensureSchema = require("./ensureSchema")
const rootConfig = require("../../config")

const { constants: globalConstants = {} } = rootConfig
const leaderboardSettings = rootConfig.leaderboard || {}

const DEFAULT_LEADERBOARD_LIMIT = leaderboardSettings.entries ?? 10
const MAX_LEADERBOARD_LIMIT = leaderboardSettings.maxEntries ?? Math.max(10, DEFAULT_LEADERBOARD_LIMIT)
const MIN_WIN_RATE_HANDS = leaderboardSettings.winRate?.minHands ?? 25
const HIDE_PRIVATE_BALANCES = leaderboardSettings.privacy?.hidePrivateBalances !== false

const fallbackMetrics = ["net-profit", "chips", "win-rate"]
const leaderboardMetricDefinitions = (Array.isArray(leaderboardSettings.metrics) && leaderboardSettings.metrics.length
    ? leaderboardSettings.metrics
    : fallbackMetrics.map((id) => ({ id })))
    .reduce((acc, metric) => {
        if (metric && metric.id) {
            acc[metric.id] = metric
        }
        return acc
    }, {})

const DEFAULT_LEADERBOARD_METRIC = (() => {
    if (leaderboardMetricDefinitions[leaderboardSettings.defaultMetric]) {
        return leaderboardSettings.defaultMetric
    }
    const firstMetric = Object.keys(leaderboardMetricDefinitions)[0]
    return firstMetric || "net-profit"
})()

const leaderboardCacheConfig = leaderboardSettings.cache || {}
const LEADERBOARD_CACHE_TABLE = leaderboardCacheConfig.table || "leaderboard_cache"
const CACHE_METRIC_IDS = Object.keys(leaderboardMetricDefinitions)
const CACHE_HYDRATE_LIMIT = Math.max(
    leaderboardCacheConfig.hydrateBatchSize || DEFAULT_LEADERBOARD_LIMIT,
    DEFAULT_LEADERBOARD_LIMIT
)

const PRIVACY_COLUMN = "bankroll_private"
const MISSING_COLUMN_ERRNO = 1054
const MISSING_TABLE_ERRNO = 1146

const isMissingColumnError = (error, column) => {
    if (!error) return false
    const message = (error.sqlMessage || error.message || "").toLowerCase()
    if (column && !message.includes(column.toLowerCase())) return false
    return error.code === "ER_BAD_FIELD_ERROR" || error.errno === MISSING_COLUMN_ERRNO || message.includes("unknown column")
}
const isMissingTableError = (error, table) => {
    if (!error) return false
    const message = (error.sqlMessage || error.message || "").toLowerCase()
    if (table && !message.includes(table.toLowerCase())) {
        return error.code === "ER_NO_SUCH_TABLE" || error.errno === MISSING_TABLE_ERRNO
    }
    return error.code === "ER_NO_SUCH_TABLE" || error.errno === MISSING_TABLE_ERRNO || message.includes("doesn't exist")
}
const mapUserRecord = (record) => {
    if (!record) return null
    return normalizeUserExperience(record)
}

const toNumber = (value, fallback = 0) => {
    if (value === null || value === undefined || value === "") return fallback
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
}

const computeWinRateValue = (user) => {
    const handsPlayed = toNumber(user?.hands_played)
    if (!handsPlayed || handsPlayed <= 0) {
        return 0
    }
    const handsWon = toNumber(user?.hands_won)
    return handsWon > 0 ? Math.min(Math.max(handsWon / handsPlayed, 0), 1) : 0
}

const resolveMetricScore = (metricId, user) => {
    const winRate = computeWinRateValue(user)
    if (metricId === "win-rate") {
        if (MIN_WIN_RATE_HANDS > 0 && toNumber(user?.hands_played) < MIN_WIN_RATE_HANDS) {
            return null
        }
        return { score: winRate, winRate }
    }

    if (metricId === "chips") {
        return { score: toNumber(user?.money), winRate }
    }

    return { score: toNumber(user?.net_winnings), winRate }
}

const buildCacheOrderColumns = (metricId) => {
    if (metricId === "win-rate") {
        return [
            { column: "score", property: "score", direction: "DESC" },
            { column: "hands_played", property: "hands_played", direction: "DESC" },
            { column: "money", property: "money", direction: "DESC" }
        ]
    }

    if (metricId === "chips") {
        return [
            { column: "score", property: "score", direction: "DESC" },
            { column: "level", property: "level", direction: "DESC" },
            { column: "net_winnings", property: "net_winnings", direction: "DESC" }
        ]
    }

    return [
        { column: "score", property: "score", direction: "DESC" },
        { column: "money", property: "money", direction: "DESC" },
        { column: "level", property: "level", direction: "DESC" }
    ]
}

const buildCacheOrderClause = (metricId) => {
    return buildCacheOrderColumns(metricId)
        .map((definition) => `\`${definition.column}\` ${definition.direction}`)
        .join(", ")
}

const buildRankDominanceClause = (metricId, entry) => {
    const columns = buildCacheOrderColumns(metricId)
    const fragments = []
    const params = []

    columns.forEach((definition, index) => {
        const conditions = []
        for (let i = 0; i < index; i++) {
            const previous = columns[i]
            conditions.push(`COALESCE(\`${previous.column}\`, 0) = ?`)
            params.push(toNumber(entry?.[previous.property]))
        }
        const operator = definition.direction === "DESC" ? ">" : "<"
        conditions.push(`COALESCE(\`${definition.column}\`, 0) ${operator} ?`)
        params.push(toNumber(entry?.[definition.property]))
        fragments.push(`(${conditions.join(" AND ")})`)
    })

    if (!fragments.length) {
        return { clause: null, params: [] }
    }

    return { clause: fragments.join(" OR "), params }
}

const withLeaderboardMetadata = (record, metricId, summary = {}, extra = {}) => {
    const trend = toNumber(extra.trendDirection ?? extra.trend_direction ?? record?.trend_direction)
    const winRate = summary.winRate ?? record?.win_rate ?? computeWinRateValue(record)
    const score = summary.score ?? toNumber(record?.score)
    return {
        ...record,
        win_rate: winRate,
        leaderboard_metric: metricId,
        leaderboard_score: score,
        leaderboard_trend: trend,
        trend_direction: trend,
        score,
        score_raw: record?.score_raw ?? record?.score ?? score
    }
}

const mapCacheRow = (row) => {
    if (!row) return null
    const base = {
        metric: row.metric,
        id: row.user_id,
        money: toNumber(row.money),
        gold: toNumber(row.gold),
        current_exp: toNumber(row.current_exp),
        required_exp: toNumber(row.required_exp),
        level: toNumber(row.level),
        hands_played: toNumber(row.hands_played),
        hands_won: toNumber(row.hands_won),
        net_winnings: toNumber(row.net_winnings),
        last_played: row.last_played || null,
        join_date: row.join_date || null,
        bankroll_private: toNumber(row.bankroll_private),
        score: toNumber(row.score),
        score_raw: row.score,
        win_rate: toNumber(row.win_rate),
        trend_direction: toNumber(row.trend_direction),
        updated_at: row.updated_at || null
    }
    return withLeaderboardMetadata(base, row.metric, { score: base.score, winRate: base.win_rate }, { trendDirection: base.trend_direction })
}

const upsertLeaderboardCacheEntries = async(connection, user, metrics = CACHE_METRIC_IDS) => {
    if (!connection || !user?.id || !Array.isArray(metrics) || metrics.length === 0) {
        return
    }
    const basePayload = {
        money: toNumber(user.money),
        gold: toNumber(user.gold),
        current_exp: toNumber(user.current_exp),
        required_exp: toNumber(user.required_exp),
        level: toNumber(user.level),
        hands_played: toNumber(user.hands_played),
        hands_won: toNumber(user.hands_won),
        net_winnings: toNumber(user.net_winnings),
        last_played: user.last_played ? new Date(user.last_played) : null,
        join_date: user.join_date ? new Date(user.join_date) : null,
        bankroll_private: toNumber(user.bankroll_private)
    }

    const winRate = computeWinRateValue({
        hands_played: basePayload.hands_played,
        hands_won: basePayload.hands_won
    })

    for (const metricId of metrics) {
        const summary = resolveMetricScore(metricId, {
            ...basePayload,
            win_rate: winRate
        })

        if (!summary) {
            await connection.query(
                `DELETE FROM \`${LEADERBOARD_CACHE_TABLE}\` WHERE \`metric\` = ? AND \`user_id\` = ?`,
                [metricId, user.id]
            )
            continue
        }

        const sql = `INSERT INTO \`${LEADERBOARD_CACHE_TABLE}\` (
                \`metric\`, \`user_id\`, \`score\`, \`money\`, \`gold\`, \`current_exp\`, \`required_exp\`,
                \`level\`, \`hands_played\`, \`hands_won\`, \`net_winnings\`, \`win_rate\`, \`last_played\`, \`join_date\`,
                \`${PRIVACY_COLUMN}\`
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                \`score\` = VALUES(\`score\`),
                \`money\` = VALUES(\`money\`),
                \`gold\` = VALUES(\`gold\`),
                \`current_exp\` = VALUES(\`current_exp\`),
                \`required_exp\` = VALUES(\`required_exp\`),
                \`level\` = VALUES(\`level\`),
                \`hands_played\` = VALUES(\`hands_played\`),
                \`hands_won\` = VALUES(\`hands_won\`),
                \`net_winnings\` = VALUES(\`net_winnings\`),
                \`win_rate\` = VALUES(\`win_rate\`),
                \`last_played\` = VALUES(\`last_played\`),
                \`join_date\` = VALUES(\`join_date\`),
                \`${PRIVACY_COLUMN}\` = VALUES(\`${PRIVACY_COLUMN}\`),
                \`trend_direction\` = CASE
                    WHEN VALUES(\`score\`) > \`${LEADERBOARD_CACHE_TABLE}\`.\`score\` THEN LEAST(1, \`${LEADERBOARD_CACHE_TABLE}\`.\`trend_direction\` + 1)
                    WHEN VALUES(\`score\`) < \`${LEADERBOARD_CACHE_TABLE}\`.\`score\` THEN GREATEST(-1, \`${LEADERBOARD_CACHE_TABLE}\`.\`trend_direction\` - 1)
                    ELSE \`${LEADERBOARD_CACHE_TABLE}\`.\`trend_direction\`
                END,
                \`updated_at\` = CURRENT_TIMESTAMP`

        await connection.query(sql, [
            metricId,
            user.id,
            summary.score,
            basePayload.money,
            basePayload.gold,
            basePayload.current_exp,
            basePayload.required_exp,
            basePayload.level,
            basePayload.hands_played,
            basePayload.hands_won,
            basePayload.net_winnings,
            summary.winRate,
            basePayload.last_played,
            basePayload.join_date,
            basePayload.bankroll_private
        ])
    }
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

    const syncLeaderboardCache = async(user, { metrics } = {}) => {
        if (!user?.id || !CACHE_METRIC_IDS.length) {
            return
        }
        try {
            await withTransaction(pool, async(connection) => {
                await upsertLeaderboardCacheEntries(connection, user, metrics || CACHE_METRIC_IDS)
            }, { operation: "leaderboardCacheSync", id: user.id })
        } catch (error) {
            if (isMissingTableError(error, LEADERBOARD_CACHE_TABLE)) {
                await ensureSchema(pool)
                return
            }
            logError("Failed to refresh leaderboard cache", {
                scope: "mysql",
                operation: "leaderboardCacheSync",
                id: user.id,
                message: error.message
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

        const context = { operation: "createUserData", id }
        try {
            return await withTransaction(pool, async(connection) => {
                await connection.query("INSERT INTO `users` (`id`) VALUES (?)", [id])
                const [results] = await connection.query("SELECT * FROM `users` WHERE `id` = ?", [id])
                const record = mapUserRecord(results[0])
                await upsertLeaderboardCacheEntries(connection, record)
                return record
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
                const record = mapUserRecord(results[0])
                await upsertLeaderboardCacheEntries(connection, record)
                return record
            }, context)
        } catch (error) {
            handleError(error, context)
        }
    }

    const resolveDBUser = (user) => {
        if (!user || !user.data) throw new Error("User data is required to resolve the database payload.")
        const normalized = normalizeUserExperience(user.data)

        if (user.data && typeof user.data === "object") {
            Object.assign(user.data, normalized)
        } else {
            user.data = { ...normalized }
        }

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
            net_winnings: user.data.net_winnings || 0,
            withholding_upgrade: user.data.withholding_upgrade,
            reward_amount_upgrade: user.data.reward_amount_upgrade,
            reward_time_upgrade: user.data.reward_time_upgrade,
            win_probability_upgrade: user.data.win_probability_upgrade,
            bankroll_private: user.data.bankroll_private || 0,
            next_reward: user.data.next_reward,
            last_played: user.data.last_played || new Date(),
            join_date: user.data.join_date || new Date()
        }
    }

    const redeemReward = async(id, { amount, cooldownMs, now = new Date() } = {}) => {
        if (!id) throw new Error("User id is required.")
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Reward amount must be a positive number.")
        }
        if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
            throw new Error("Reward cooldown must be a positive number of milliseconds.")
        }

        const context = { operation: "redeemReward", id }
        try {
            const [existingRows] = await pool.query(
                "SELECT `next_reward` FROM `users` WHERE `id` = ? LIMIT 1",
                [id]
            )

            if (!existingRows.length) {
                return { ok: false, reason: "not-found" }
            }

            const nowDate = now instanceof Date ? now : new Date(now)
            const nextRewardDate = new Date(nowDate.getTime() + cooldownMs)

            const [result] = await pool.query(
                "UPDATE `users` SET `money` = `money` + ?, `next_reward` = ? WHERE `id` = ? AND (next_reward IS NULL OR next_reward <= ?)",
                [amount, nextRewardDate, id, nowDate]
            )

            if (!result.affectedRows) {
                const nextReward = existingRows[0]?.next_reward
                    ? new Date(existingRows[0].next_reward)
                    : null
                return {
                    ok: false,
                    reason: "cooldown",
                    nextReward
                }
            }

            const updated = await getUserData(id)
            await syncLeaderboardCache(updated)
            return { ok: true, data: updated }
        } catch (error) {
            handleError(error, context)
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

    const resolveLeaderboardMetric = (metricId) => {
        if (metricId && leaderboardMetricDefinitions[metricId]) {
            return metricId
        }
        return DEFAULT_LEADERBOARD_METRIC
    }

    const buildLeaderboardFragments = (metricId) => {
        if (metricId === "win-rate") {
            const where = []
            const whereParams = []
            if (MIN_WIN_RATE_HANDS > 0) {
                where.push("COALESCE(u.`hands_played`, 0) >= ?")
                whereParams.push(MIN_WIN_RATE_HANDS)
            }
            return {
                select: [
                    "CASE WHEN COALESCE(u.`hands_played`, 0) > 0 THEN u.`hands_won` / u.`hands_played` ELSE 0 END AS win_rate"
                ],
                where,
                whereParams,
                orderBy: "win_rate DESC, u.`hands_played` DESC, u.`money` DESC"
            }
        }

        if (metricId === "chips") {
            return {
                orderBy: "u.`money` DESC, u.`level` DESC"
            }
        }

        return {
            select: ["COALESCE(u.`net_winnings`, 0) AS net_profit"],
            orderBy: "net_profit DESC, u.`money` DESC"
        }
    }

    const runLeaderboardQuery = async({
        metricId,
        limit,
        includePrivate,
        withCount = false
    }) => {
        const fragments = buildLeaderboardFragments(metricId)

        const selectColumns = [
            "u.`id`",
            "u.`money`",
            "u.`gold`",
            "u.`current_exp`",
            "u.`required_exp`",
            "u.`level`",
            "u.`hands_played`",
            "u.`hands_won`",
            "u.`biggest_won`",
            "u.`biggest_bet`",
            "u.`net_winnings`",
            "u.`withholding_upgrade`",
            "u.`reward_amount_upgrade`",
            "u.`reward_time_upgrade`",
            "u.`win_probability_upgrade`",
            "u.`bankroll_private`",
            "u.`next_reward`",
            "u.`last_played`",
            "u.`join_date`"
        ]

        const selectParams = []
        if (Array.isArray(fragments.select) && fragments.select.length > 0) {
            selectColumns.push(...fragments.select)
        }
        if (Array.isArray(fragments.selectParams) && fragments.selectParams.length > 0) {
            selectParams.push(...fragments.selectParams)
        }

        const conditions = []
        const whereParams = []

        if (Array.isArray(fragments.where) && fragments.where.length > 0) {
            conditions.push(...fragments.where)
        }
        if (Array.isArray(fragments.whereParams) && fragments.whereParams.length > 0) {
            whereParams.push(...fragments.whereParams)
        }

        if (HIDE_PRIVATE_BALANCES && !includePrivate) {
            conditions.push(`COALESCE(u.\`${PRIVACY_COLUMN}\`, 0) = 0`)
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
        const sql = `SELECT ${selectColumns.join(", ")}
            FROM \`users\` u
            ${whereClause}
            ORDER BY ${fragments.orderBy || "u.\`money\` DESC"}
            LIMIT ?`

        const params = [...selectParams, ...whereParams, limit]

        try {
            const [rows] = await pool.query(sql, params)
            let total = null
            if (withCount) {
                const countSql = `SELECT COUNT(*) AS total FROM \`users\` u ${whereClause}`
                const [countRows] = await pool.query(countSql, [...whereParams])
                total = Number(countRows[0]?.total) || 0
            }
            return { rows, total }
        } catch (error) {
            if (isMissingColumnError(error)) {
                await ensureSchema(pool)
                const [rows] = await pool.query(sql, params)
                let total = null
                if (withCount) {
                    const countSql = `SELECT COUNT(*) AS total FROM \`users\` u ${whereClause}`
                    const [countRows] = await pool.query(countSql, [...whereParams])
                    total = Number(countRows[0]?.total) || 0
                }
                return { rows, total }
            }
            throw error
        }
    }

    const hydrateCacheFromRows = async(rows, metricId) => {
        if (!Array.isArray(rows) || rows.length === 0) {
            return []
        }
        const normalized = rows.map(mapUserRecord).filter(Boolean)
        try {
            await withTransaction(pool, async(connection) => {
                for (const record of normalized) {
                    await upsertLeaderboardCacheEntries(connection, record, [metricId])
                }
            }, { operation: "leaderboardCacheHydrate", metric: metricId })
        } catch (error) {
            if (isMissingTableError(error, LEADERBOARD_CACHE_TABLE)) {
                await ensureSchema(pool)
            } else {
                logError("Failed to hydrate leaderboard cache", {
                    scope: "mysql",
                    operation: "leaderboardCacheHydrate",
                    metric: metricId,
                    message: error.message
                })
            }
        }
        return normalized.map((record) => {
            const summary = resolveMetricScore(metricId, record)
            if (!summary) {
                return null
            }
            return withLeaderboardMetadata(record, metricId, summary, { trendDirection: 0 })
        }).filter(Boolean)
    }

    const queryLeaderboardCacheSnapshot = async({
        metricId,
        limit,
        offset = 0,
        includePrivate,
        userIds,
        searchTerm,
        withTotal = false
    }) => {
        const normalizedLimit = Math.min(Math.max(Number(limit) || DEFAULT_LEADERBOARD_LIMIT, 1), MAX_LEADERBOARD_LIMIT)
        const normalizedOffset = Math.max(Number(offset) || 0, 0)

        if (Array.isArray(userIds) && userIds.length === 0) {
            return { items: [], total: withTotal ? 0 : null, limit: normalizedLimit, offset: normalizedOffset }
        }

        const filters = ["`metric` = ?"]
        const params = [metricId]

        if (HIDE_PRIVATE_BALANCES && !includePrivate) {
            filters.push(`COALESCE(\`${PRIVACY_COLUMN}\`, 0) = 0`)
        }

        const searchBlocks = []
        if (Array.isArray(userIds) && userIds.length > 0) {
            const placeholders = userIds.map(() => "?").join(", ")
            searchBlocks.push(`\`user_id\` IN (${placeholders})`)
            params.push(...userIds)
        }
        if (typeof searchTerm === "string" && searchTerm.trim().length > 0) {
            searchBlocks.push("`user_id` LIKE ?")
            params.push(searchTerm)
        }
        if (searchBlocks.length > 0) {
            filters.push(`(${searchBlocks.join(" OR ")})`)
        }

        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
        const orderClause = buildCacheOrderClause(metricId)
        const sql = `SELECT * FROM \`${LEADERBOARD_CACHE_TABLE}\`
            ${whereClause}
            ORDER BY ${orderClause}
            LIMIT ? OFFSET ?`

        const queryParams = [...params, normalizedLimit, normalizedOffset]

        try {
            const [rows] = await pool.query(sql, queryParams)
            let total = null
            if (withTotal) {
                const countSql = `SELECT COUNT(*) AS total FROM \`${LEADERBOARD_CACHE_TABLE}\` ${whereClause}`
                const [countRows] = await pool.query(countSql, params)
                total = Number(countRows[0]?.total) || 0
            }

            let items = rows.map((row) => mapUserRecord(mapCacheRow(row))).filter(Boolean)

            const shouldWarmup = items.length === 0
                && normalizedOffset === 0
                && (!Array.isArray(userIds) || userIds.length === 0)
                && !searchTerm

            if (shouldWarmup) {
                const fallback = await runLeaderboardQuery({
                    metricId,
                    limit: Math.max(normalizedLimit, CACHE_HYDRATE_LIMIT),
                    includePrivate,
                    withCount: withTotal
                })
                const hydrated = await hydrateCacheFromRows(fallback.rows, metricId)
                items = hydrated.map((record) => mapUserRecord(record)).slice(0, normalizedLimit)
                if (withTotal) {
                    total = Number.isFinite(fallback.total) ? fallback.total : total
                }
            }

            return {
                items,
                total,
                limit: normalizedLimit,
                offset: normalizedOffset
            }
        } catch (error) {
            if (isMissingTableError(error, LEADERBOARD_CACHE_TABLE) || isMissingColumnError(error, PRIVACY_COLUMN)) {
                await ensureSchema(pool)
                return queryLeaderboardCacheSnapshot({
                    metricId,
                    limit: normalizedLimit,
                    offset: normalizedOffset,
                    includePrivate,
                    userIds,
                    searchTerm,
                    withTotal
                })
            }
            throw error
        }
    }

    const getLeaderboard = async({
        metric = DEFAULT_LEADERBOARD_METRIC,
        limit = DEFAULT_LEADERBOARD_LIMIT,
        includePrivate = false,
        offset = 0
    } = {}) => {
        const resolvedMetric = resolveLeaderboardMetric(metric)
        const normalizedLimit = Math.min(
            Math.max(Number(limit) || DEFAULT_LEADERBOARD_LIMIT, 1),
            MAX_LEADERBOARD_LIMIT
        )
        const normalizedOffset = Math.max(Number(offset) || 0, 0)

        try {
            const snapshot = await queryLeaderboardCacheSnapshot({
                metricId: resolvedMetric,
                limit: normalizedLimit,
                offset: normalizedOffset,
                includePrivate
            })

            return {
                metric: resolvedMetric,
                items: snapshot.items,
                meta: {
                    limit: normalizedLimit,
                    offset: normalizedOffset,
                    privacyFilterApplied: HIDE_PRIVATE_BALANCES && !includePrivate
                }
            }
        } catch (error) {
            handleError(error, {
                operation: "getLeaderboard",
                metric: resolvedMetric,
                limit: normalizedLimit
            })
        }
    }

    const getLeaderboardPage = async({
        metric = DEFAULT_LEADERBOARD_METRIC,
        page = 1,
        pageSize = DEFAULT_LEADERBOARD_LIMIT,
        includePrivate = false,
        userIds,
        searchTerm
    } = {}) => {
        const resolvedMetric = resolveLeaderboardMetric(metric)
        const normalizedPageSize = Math.min(
            Math.max(Number(pageSize) || DEFAULT_LEADERBOARD_LIMIT, 1),
            MAX_LEADERBOARD_LIMIT
        )
        const normalizedPage = Math.max(Number(page) || 1, 1)
        const offset = (normalizedPage - 1) * normalizedPageSize

        try {
            const snapshot = await queryLeaderboardCacheSnapshot({
                metricId: resolvedMetric,
                limit: normalizedPageSize,
                offset,
                includePrivate,
                userIds,
                searchTerm,
                withTotal: true
            })
            const total = Number(snapshot.total) || 0
            const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 0

            return {
                metric: resolvedMetric,
                items: snapshot.items,
                meta: {
                    page: normalizedPage,
                    pageSize: normalizedPageSize,
                    total,
                    totalPages,
                    privacyFilterApplied: HIDE_PRIVATE_BALANCES && !includePrivate
                }
            }
        } catch (error) {
            handleError(error, {
                operation: "getLeaderboardPage",
                metric: resolvedMetric,
                page: normalizedPage,
                pageSize: normalizedPageSize
            })
        }
    }

    const getLeaderboardEntry = async({
        metric = DEFAULT_LEADERBOARD_METRIC,
        userId,
        includePrivate = false
    } = {}) => {
        if (!userId) {
            throw new Error("User id is required to resolve leaderboard entry.")
        }
        const resolvedMetric = resolveLeaderboardMetric(metric)

        const filters = ["`metric` = ?", "`user_id` = ?"]
        const params = [resolvedMetric, userId]
        if (HIDE_PRIVATE_BALANCES && !includePrivate) {
            filters.push(`COALESCE(\`${PRIVACY_COLUMN}\`, 0) = 0`)
        }

        const sql = `SELECT * FROM \`${LEADERBOARD_CACHE_TABLE}\` WHERE ${filters.join(" AND ")} LIMIT 1`

        const fetchEntry = async() => {
            try {
                const [rows] = await pool.query(sql, params)
                if (!rows.length) {
                    return null
                }
                return mapUserRecord(mapCacheRow(rows[0]))
            } catch (error) {
                if (isMissingTableError(error, LEADERBOARD_CACHE_TABLE)) {
                    await ensureSchema(pool)
                    return fetchEntry()
                }
                throw error
            }
        }

        try {
            let entry = await fetchEntry()
            if (!entry) {
                const user = await getUserData(userId)
                if (!user) {
                    return null
                }
                await syncLeaderboardCache(user, { metrics: [resolvedMetric] })
                const snapshot = await queryLeaderboardCacheSnapshot({
                    metricId: resolvedMetric,
                    limit: 1,
                    includePrivate,
                    userIds: [userId]
                })
                entry = snapshot.items[0] || null
            }

            if (!entry) {
                return null
            }

            const dominance = buildRankDominanceClause(resolvedMetric, entry)
            let rank = 1
            if (dominance.clause) {
                const dominanceFilters = ["`metric` = ?"]
                const dominanceParams = [resolvedMetric]
                if (HIDE_PRIVATE_BALANCES && !includePrivate) {
                    dominanceFilters.push(`COALESCE(\`${PRIVACY_COLUMN}\`, 0) = 0`)
                }
                dominanceFilters.push(`(${dominance.clause})`)
                const rankSql = `SELECT COUNT(*) AS higher FROM \`${LEADERBOARD_CACHE_TABLE}\` WHERE ${dominanceFilters.join(" AND ")}`
                const rankParams = [...dominanceParams, ...dominance.params]
                const [rankRows] = await pool.query(rankSql, rankParams)
                rank = (Number(rankRows[0]?.higher) || 0) + 1
            }

            return {
                metric: resolvedMetric,
                entry,
                rank,
                meta: {
                    privacyFilterApplied: HIDE_PRIVATE_BALANCES && !includePrivate
                }
            }
        } catch (error) {
            handleError(error, {
                operation: "getLeaderboardEntry",
                metric: resolvedMetric,
                userId
            })
        }
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

        const searchClauses = []
        if (Array.isArray(userIds) && userIds.length > 0) {
            const placeholders = userIds.map(() => "?").join(", ")
            searchClauses.push({
                clause: `u.\`id\` IN (${placeholders})`,
                values: userIds
            })
        }
        if (typeof search === "string" && search.trim().length > 0) {
            searchClauses.push({
                clause: "u.`id` LIKE ?",
                values: [`%${search.trim()}%`]
            })
        }
        if (searchClauses.length > 0) {
            filters.push(`(${searchClauses.map((entry) => entry.clause).join(" OR ")})`)
            searchClauses.forEach((entry) => {
                params.push(...entry.values)
            })
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
        redeemReward,
        getLeaderboard,
        getLeaderboardPage,
        getLeaderboardEntry,
        listUsers
    }
}

module.exports = createDataHandler
