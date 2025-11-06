const express = require("express")
const config = require("../../config")
const { asyncHandler } = require("../middleware/errorHandler")
const { leaderboardSearchLimiter } = require("../middleware/rateLimiter")
const { buildMomentumSignature } = require("../../shared/leaderboard/analytics")

const leaderboardSettings = config.leaderboard || {}
const metricDefinitions = Object.values(leaderboardSettings.metrics || []).filter((metric) => metric?.id)
const tokens = leaderboardSettings.tokens || {}
const accessRules = leaderboardSettings.access || {}
const dayMs = 24 * 60 * 60 * 1000
const clamp01 = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0
    }
    if (numeric >= 1) {
        return 1
    }
    return numeric
}
const toWinRatePercentage = (value) => clamp01(value) * 100

const resolveMetricValue = (metricId, entry) => {
    if (metricId === "chips") {
        return {
            type: "currency",
            raw: Number(entry.money) || 0
        }
    }
    if (metricId === "win-rate") {
        return {
            type: "percentage",
            raw: toWinRatePercentage(entry.win_rate)
        }
    }
    return {
        type: "currency",
        raw: Number(entry.net_winnings) || 0
    }
}

const buildFallbackAvatar = (userId) => {
    const bucket = Math.abs(Number(userId || 0)) % 5
    return `https://cdn.discordapp.com/embed/avatars/${bucket}.png?size=128`
}

const resolveProfile = (profile, userId) => {
    if (!profile) {
        return {
            displayName: `Player ${userId}`,
            avatar: buildFallbackAvatar(userId)
        }
    }
    const displayName = profile.tag
        || profile.globalName
        || profile.username
        || `Player ${userId}`
    const avatar = profile.avatar || buildFallbackAvatar(userId)
    return { displayName, avatar }
}

const fetchProfiles = async(discordDirectory, userIds = []) => {
    if (!discordDirectory?.users?.fetch || !Array.isArray(userIds) || !userIds.length) {
        return new Map()
    }
    const unique = [...new Set(userIds)]
    const pairs = await Promise.all(unique.map(async(id) => {
        try {
            const profile = await discordDirectory.users.fetch(id)
            return [id, profile]
        } catch (error) {
            return [id, null]
        }
    }))
    return new Map(pairs)
}

const mapTrendDirection = (value = 0) => {
    if (value > 0) return "up"
    if (value < 0) return "down"
    return "steady"
}

const buildHighlightMeta = (entry) => {
    const { highlightDays = 7, dormantDays = 30 } = leaderboardSettings.activity || {}
    const highlightLimit = highlightDays * dayMs
    const dormantLimit = dormantDays * dayMs
    const lastPlayed = entry.last_played ? new Date(entry.last_played) : null
    const lastTimestamp = lastPlayed ? lastPlayed.getTime() : null
    const now = Date.now()
    const sinceLast = lastTimestamp ? now - lastTimestamp : null
    return {
        lastPlayedAt: lastPlayed ? lastPlayed.toISOString() : null,
        isActive: sinceLast !== null && sinceLast <= highlightLimit,
        isDormant: sinceLast !== null && sinceLast >= dormantLimit
    }
}

const applySecurityMask = (entry, { maskWinRate, maskHands }) => {
    const stats = {
        netProfit: Number(entry.net_winnings) || 0,
        chips: Number(entry.money) || 0
    }
    if (!maskWinRate) {
        stats.winRate = toWinRatePercentage(entry.win_rate)
    }
    if (!maskHands) {
        stats.handsPlayed = Number(entry.hands_played) || 0
        stats.handsWon = Number(entry.hands_won) || 0
    }
    return stats
}

const formatEntries = async({
    dataset,
    baseRank = 0,
    viewerId,
    isAuthenticated,
    discordDirectory
}) => {
    const metricId = dataset.metric
    const maskWinRate = !isAuthenticated && accessRules.maskWinRateWhenPublic !== false
    const maskHands = !isAuthenticated && accessRules.maskHandsWhenPublic !== false
    const profiles = await fetchProfiles(discordDirectory, dataset.items.map((entry) => entry.id))
    const podiumPalette = Array.isArray(tokens.podium) ? tokens.podium : []
    const badgeTokens = tokens.badges || {}

    const items = dataset.items.map((entry, index) => {
        const rank = baseRank + index + 1
        const profile = resolveProfile(profiles.get(entry.id), entry.id)
        const momentum = buildMomentumSignature(entry)
        const highlight = buildHighlightMeta(entry)
        const metricValue = resolveMetricValue(metricId, entry)
        const stats = applySecurityMask(entry, { maskWinRate, maskHands })
        const badgePalette = podiumPalette[index] || badgeTokens.default || null
        const activityPalette = highlight.isActive
            ? badgeTokens.active
            : highlight.isDormant
                ? badgeTokens.dormant
                : null

        return {
            rank,
            userId: entry.id,
            displayName: profile.displayName,
            avatar: profile.avatar,
            metricValue,
            stats,
            score: Number(entry.leaderboard_score || entry.score || 0),
            trend: {
                direction: mapTrendDirection(entry.leaderboard_trend || entry.trend_direction),
                momentum: momentum.signature,
                indicator: momentum.trendEmoji
            },
            highlight: {
                ...highlight,
                badge: activityPalette
            },
            badge: badgePalette,
            momentum,
            isViewer: Boolean(viewerId && entry.id === viewerId),
            isPrivate: Boolean(entry.bankroll_private)
        }
    })

    const viewerEntry = viewerId
        ? items.find((item) => item.userId === viewerId) || null
        : null

    return {
        items,
        viewer: viewerEntry
    }
}

const resolveSearchFilters = async(search, { discordDirectory }) => {
    if (typeof search !== "string" || !search.trim()) {
        return { searchTerm: null, userIds: null }
    }
    const trimmed = search.trim()
    const userIds = new Set()
    if (/^\d+$/.test(trimmed)) {
        userIds.add(trimmed)
    }
    if (discordDirectory?.lookupUserIdsByName) {
        try {
            const matches = await discordDirectory.lookupUserIdsByName(trimmed)
            matches.forEach((id) => userIds.add(id))
        } catch (error) {
            // swallow lookup errors
        }
    }
    const searchTerm = trimmed.length >= 3 ? `%${trimmed}%` : null
    return {
        searchTerm,
        userIds: userIds.size ? Array.from(userIds) : null
    }
}

const createLeaderboardRouter = ({ dataHandler, discordDirectory } = {}) => {
    if (!dataHandler || typeof dataHandler.getLeaderboard !== "function") {
        throw new Error("Leaderboard router requires a valid data handler")
    }

    const router = express.Router()

    const ensureSearchAccess = (req, res, next) => {
        if (!accessRules.requireAuthForSearch || !req.query?.search) {
            return next()
        }
        if (req.user) {
            return next()
        }
        return res.status(403).json({ message: "403: Forbidden" })
    }

    const applySearchLimiter = (req, res, next) => {
        if (req.query?.search && req.user) {
            return leaderboardSearchLimiter(req, res, next)
        }
        return next()
    }

    router.get("/top", asyncHandler(async(req, res) => {
        const { metric, limit } = req.query || {}
        const viewerId = req.user?.id || null
        const includePrivate = Boolean(req.permissions?.canAccessPanel)
        const dataset = await dataHandler.getLeaderboard({
            metric,
            limit,
            includePrivate
        })
        const formatted = await formatEntries({
            dataset,
            baseRank: 0,
            viewerId,
            isAuthenticated: Boolean(req.user),
            discordDirectory
        })

        res.json({
            metric: dataset.metric,
            items: formatted.items,
            meta: {
                limit: dataset.meta?.limit,
                privacyFilterApplied: dataset.meta?.privacyFilterApplied,
                metrics: metricDefinitions,
                viewer: formatted.viewer,
                emptyState: leaderboardSettings.emptyState,
                tokens,
                security: {
                    maskWinRate: !req.user && accessRules.maskWinRateWhenPublic !== false,
                    maskHands: !req.user && accessRules.maskHandsWhenPublic !== false
                }
            }
        })
    }))

    router.get(
        "/",
        ensureSearchAccess,
        applySearchLimiter,
        asyncHandler(async(req, res) => {
            const {
                metric,
                page,
                pageSize,
                search
            } = req.query || {}
            const includePrivate = Boolean(req.permissions?.canAccessPanel)
            const filters = await resolveSearchFilters(search, { discordDirectory })
            const dataset = await dataHandler.getLeaderboardPage({
                metric,
                page,
                pageSize,
                includePrivate,
                userIds: filters.userIds,
                searchTerm: filters.searchTerm
            })
            const baseRank = ((dataset.meta?.page || 1) - 1) * (dataset.meta?.pageSize || 0)
            const formatted = await formatEntries({
                dataset,
                baseRank,
                viewerId: req.user?.id || null,
                isAuthenticated: Boolean(req.user),
                discordDirectory
            })

            res.json({
                metric: dataset.metric,
                items: formatted.items,
                meta: {
                    ...dataset.meta,
                    viewer: formatted.viewer,
                    metrics: metricDefinitions,
                    emptyState: leaderboardSettings.emptyState,
                    tokens,
                    security: {
                        maskWinRate: !req.user && accessRules.maskWinRateWhenPublic !== false,
                        maskHands: !req.user && accessRules.maskHandsWhenPublic !== false
                    }
                }
            })
        })
    )

    router.get("/me", asyncHandler(async(req, res) => {
        if (!req.user?.id) {
            return res.status(401).json({ message: "401: Session required" })
        }
        const { metric } = req.query || {}
        const includePrivate = Boolean(req.permissions?.canAccessPanel)
        const payload = await dataHandler.getLeaderboardEntry({
            metric,
            userId: req.user.id,
            includePrivate
        })
        if (!payload) {
            return res.status(404).json({ message: "404: Not Found" })
        }
        const formatted = await formatEntries({
            dataset: { metric: payload.metric, items: [payload.entry] },
            baseRank: payload.rank - 1,
            viewerId: req.user.id,
            isAuthenticated: true,
            discordDirectory
        })
        res.json({
            metric: payload.metric,
            rank: payload.rank,
            entry: formatted.items[0],
            meta: {
                privacyFilterApplied: payload.meta?.privacyFilterApplied,
                metrics: metricDefinitions,
                emptyState: leaderboardSettings.emptyState,
                tokens
            }
        })
    }))

    return router
}

module.exports = createLeaderboardRouter
