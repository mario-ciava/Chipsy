const { MessageFlags, EmbedBuilder, Colors } = require("discord.js")
const config = require("../../config")
const logger = require("./logger")

const { logAndSuppress } = logger

const ACCESS_CACHE_TTL_MS = config.interactionAccess?.cacheTtlMs ?? 8000
const DENIAL_NOTICE_COOLDOWN_MS = config.interactionAccess?.denialNoticeCooldownMs ?? 3500

const accessCache = new Map()
const denialCooldowns = new Map()

const DENIAL_MESSAGES = Object.freeze({
    blacklisted: "🚫 You are blacklisted and cannot use Chipsy.",
    whitelist: "⚠️ Chipsy is currently restricted to the whitelist. Please contact an admin to gain access.",
    "guild-quarantine": "🚧 This server is awaiting approval before Chipsy can respond here.",
    "missing-user": "❌ Unable to resolve your Discord account. Please try again.",
    "policy-error": "❌ Unable to verify your access right now. Please try again later.",
    "access-denied": "❌ Unable to verify your access right now. Please try again later."
})

const buildCacheKey = (userId, guildId) => {
    if (!userId) return null
    return guildId ? `${userId}:${guildId}` : userId
}

const buildGuildContext = (interaction) => {
    if (!interaction) return {}
    const guild = interaction.guild || null
    return {
        guildId: interaction.guildId ?? guild?.id ?? null,
        guildName: guild?.name || null,
        guildOwnerId: guild?.ownerId || guild?.owner?.id || null,
        guildMemberCount: guild?.memberCount ?? null
    }
}

const cacheAccessResult = (userId, guildId, result) => {
    const key = buildCacheKey(userId, guildId)
    if (!key) return result
    accessCache.set(key, {
        result,
        expiresAt: Date.now() + ACCESS_CACHE_TTL_MS
    })
    return result
}

const getCachedAccessResult = (userId, guildId) => {
    const key = buildCacheKey(userId, guildId)
    if (!key || !accessCache.has(key)) return null
    const cached = accessCache.get(key)
    if (cached.expiresAt > Date.now()) {
        return cached.result
    }
    accessCache.delete(key)
    return null
}

const getAccessDeniedMessage = (reason) => {
    if (!reason || reason === "bot-user") {
        return null
    }
    return DENIAL_MESSAGES[reason] || null
}

const evaluateInteractionAccess = async(interaction) => {
    if (!interaction?.user?.id) {
        return { allowed: false, reason: "missing-user" }
    }

    const guildContext = buildGuildContext(interaction)
    const cached = getCachedAccessResult(interaction.user.id, guildContext.guildId)
    if (cached) {
        return cached
    }

    const accessControl = interaction?.client?.accessControl
    if (!accessControl || typeof accessControl.evaluateBotAccess !== "function") {
        return cacheAccessResult(interaction.user.id, guildContext.guildId, { allowed: true })
    }

    try {
        const result = await accessControl.evaluateBotAccess(interaction.user.id, guildContext)
        if (!result || result.allowed !== false) {
            return cacheAccessResult(
                interaction.user.id,
                guildContext.guildId,
                { allowed: true, record: result?.record, policy: result?.policy }
            )
        }
        return cacheAccessResult(interaction.user.id, guildContext.guildId, result)
    } catch (error) {
        logger.error("Interaction access check failed", {
            scope: "interactionAccess",
            userId: interaction.user.id,
            error: error.message
        })
        return cacheAccessResult(interaction.user.id, guildContext.guildId, { allowed: false, reason: "policy-error" })
    }
}

const shouldRateLimitNotice = (userId) => {
    if (!userId) return false
    const nextAllowedAt = denialCooldowns.get(userId)
    if (nextAllowedAt && nextAllowedAt > Date.now()) {
        return true
    }
    denialCooldowns.set(userId, Date.now() + DENIAL_NOTICE_COOLDOWN_MS)
    return false
}

const notifyAccessDenied = async(interaction, reason, meta = {}) => {
    if (!interaction) return
    const message = meta.message || getAccessDeniedMessage(reason)
    if (!message) return

    const userId = interaction.user?.id
    if (!meta.disableCooldown && shouldRateLimitNotice(userId)) {
        return
    }

    const payload = {
        embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(message)],
        flags: MessageFlags.Ephemeral
    }

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp?.(payload)
            return
        }
        if (typeof interaction.reply === "function") {
            await interaction.reply(payload)
        }
    } catch (error) {
        logAndSuppress("Failed to send access denial response", {
            scope: "interactionAccess",
            reason,
            error: error.message,
            interactionId: interaction.id,
            userId
        })(error)
    }
}

const withAccessGuard = (filter, options = {}) => {
    const wrappedFilter = typeof filter === "function" ? filter : (() => true)

    return async(...args) => {
        const interaction = args[0]
        const result = await evaluateInteractionAccess(interaction)
        if (!result.allowed) {
            if (!options.silent) {
                await notifyAccessDenied(interaction, result.reason, { scope: options.scope })
            }
            return false
        }
        return wrappedFilter(...args)
    }
}

const mapGuildRegistrationPayload = (guild) => {
    if (!guild) return null
    const context = buildGuildContext({ guild, guildId: guild?.id })
    if (!context.guildId) return null
    return {
        guildId: context.guildId,
        name: guild?.name ?? context.guildName ?? null,
        ownerId: context.guildOwnerId,
        memberCount: context.guildMemberCount
    }
}

module.exports = {
    evaluateInteractionAccess,
    withAccessGuard,
    getAccessDeniedMessage,
    buildGuildContext,
    mapGuildRegistrationPayload
}
