const {
    SlashCommandBuilder,
    EmbedBuilder,
    Colors,
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder
} = require("discord.js")
const config = require("../../config")
const createCommand = require("../utils/createCommand")
const setSeparator = require("../utils/setSeparator")
const playerClass = require("../games/classes")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const logger = require("../utils/logger")
const { withAccessGuard } = require("../utils/interactionAccess")
const {
    buildMomentumSignature,
    formatWinRate,
    clamp01
} = require("../../shared/leaderboard/analytics")

const leaderboardSettings = config.leaderboard || {}
const fallbackMetricDefinitions = [
    {
        id: "net-profit",
        label: "Net Winnings",
        icon: "💼",
        description: "Players ranked by cumulative net winnings.",
        type: "currency",
        valueSuffix: "net win",
        valueKey: ["net_profit", "net_winnings"]
    },
    {
        id: "chips",
        label: "Current Chips",
        icon: "🎲",
        description: "Ranking based on live bankroll.",
        type: "currency",
        valueKey: "money"
    },
    {
        id: "win-rate",
        label: "Win Rate",
        icon: "🎯",
        description: "Consistency over recent hands.",
        type: "percentage",
        valueSuffix: "WR",
        valueKey: "win_rate"
    }
]

const metricDefinitions = (Array.isArray(leaderboardSettings.metrics) && leaderboardSettings.metrics.length > 0
    ? leaderboardSettings.metrics
    : fallbackMetricDefinitions)
const metricMap = metricDefinitions.reduce((map, metric) => {
    if (metric?.id) {
        map[metric.id] = metric
    }
    return map
}, {})

const defaultMetricId = metricMap[leaderboardSettings.defaultMetric]
    ? leaderboardSettings.defaultMetric
    : metricDefinitions[0]?.id || "net-profit"

const podiumIcons = leaderboardSettings.highlight?.podiumIcons || ["🥇", "🥈", "🥉"]
const listIcon = leaderboardSettings.highlight?.listIcon || "➤"
const selectIdPrefix = "leaderboard_metric"
const interactionTimeoutMs = leaderboardSettings.interactionTimeoutMs || 180000
const pickColor = (color) => (typeof color === "number" ? color : null)
const EMPTY_EMBED_COLOR = pickColor(Colors.DarkGold) || pickColor(Colors.Orange) || 0xf59e0b
const MAX_EMBED_FIELD_LENGTH = 1024

const getMetricDefinition = (metricId) => metricMap[metricId] || metricDefinitions[0] || fallbackMetricDefinitions[0]

const toNumeric = (value) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : null
}

const getNetProfit = (entry) => {
    if (Number.isFinite(entry?.net_profit)) {
        return entry.net_profit
    }
    if (Number.isFinite(entry?.net_winnings)) {
        return entry.net_winnings
    }
    return 0
}

const resolveMetricValue = (metric, entry) => {
    const directScore = toNumeric(entry?.score)
    if (directScore !== null) {
        return directScore
    }
    const cachedScore = toNumeric(entry?.leaderboard_score)
    if (cachedScore !== null) {
        return cachedScore
    }
    const valueKeys = Array.isArray(metric?.valueKey)
        ? metric.valueKey
        : metric?.valueKey
            ? [metric.valueKey]
            : []
    for (const key of valueKeys) {
        const numeric = toNumeric(entry?.[key])
        if (numeric !== null) {
            return numeric
        }
    }
    const netProfit = getNetProfit(entry)
    if (Number.isFinite(netProfit)) {
        return netProfit
    }
    const fallbackMoney = toNumeric(entry?.money)
    if (fallbackMoney !== null) {
        return fallbackMoney
    }
    return 0
}

const formatCurrency = (value) => {
    if (!Number.isFinite(value)) return "0$"
    const numeric = Math.round(value)
    const absolute = Math.abs(numeric)
    const prefix = numeric >= 0 ? "+" : "-"
    return `${prefix}${setSeparator(absolute)}$`
}

const withSuffix = (value, suffix) => (suffix ? `${value} ${suffix}` : value)

const formatMetricValue = (metricId, entry) => {
    const metric = getMetricDefinition(metricId)
    const suffix = typeof metric?.valueSuffix === "string" ? metric.valueSuffix.trim() : ""
    const metricValue = resolveMetricValue(metric, entry)
    const safeMetricValue = Number.isFinite(metricValue) ? metricValue : 0

    if (metric?.type === "percentage") {
        if (metric?.id === "win-rate") {
            return withSuffix(formatWinRate(entry), suffix)
        }
        const decimals = Number.isFinite(metric?.decimals)
            ? metric.decimals
            : Number.isFinite(leaderboardSettings.winRate?.decimals)
                ? leaderboardSettings.winRate.decimals
                : 2
        const score = clamp01(safeMetricValue)
        const formatted = `${(score * 100).toFixed(decimals)}%`
        return withSuffix(formatted, suffix)
    }

    if (metric?.type === "currency") {
        return withSuffix(formatCurrency(safeMetricValue), suffix)
    }

    if (Number.isFinite(metric?.decimals) && metric.decimals > 0) {
        return withSuffix(Number(safeMetricValue).toFixed(metric.decimals), suffix)
    }
    return withSuffix(setSeparator(Math.round(safeMetricValue)), suffix)
}

const formatChipsLine = (entry) => `${setSeparator(Math.round(Number(entry?.money) || 0))}$ stack`

const resolveDisplayName = async(client, userId) => {
    if (!client?.users?.fetch) {
        return `Player ${userId}`
    }
    try {
        const user = await client.users.fetch(userId)
        const tagLabel = typeof user?.tag === "string" && user.tag.length > 0 ? `@${user.tag}` : null
        if (tagLabel) return tagLabel
        if (user?.globalName) return `@${user.globalName}`
        if (user?.username) return `@${user.username}`
        return `Player ${userId}`
    } catch (error) {
        logger.warn("Failed to resolve Discord user for leaderboard", {
            scope: "commands.leaderboard",
            userId,
            error: error?.message
        })
        return `Player ${userId}`
    }
}

const decorateEntries = async(client, entries = []) => {
    const hydrated = await Promise.all(entries.map(async(entry, index) => {
        const displayName = await resolveDisplayName(client, entry.id)
        return {
            ...entry,
            displayName,
            rank: index + 1
        }
    }))
    return hydrated
}

const formatPodiumEntry = (entry, metricId, viewerId) => {
    const icon = podiumIcons[entry.rank - 1] || `#${entry.rank}`
    const valueLabel = formatMetricValue(metricId, entry)
    const classLabel = playerClass.getUserClass(entry.money)
    const chipsLabel = formatChipsLine(entry)
    const momentum = buildMomentumSignature(entry)
    const viewerBadge = entry.id === viewerId ? " • **YOU**" : ""
    return `${icon} **${entry.displayName}**${viewerBadge}
${valueLabel} • ${classLabel}
Momentum \`${momentum.signature}\` ${momentum.trendEmoji} • ${chipsLabel}`
}

const formatChallengerEntry = (entry, metricId, viewerId) => {
    const momentum = buildMomentumSignature(entry)
    const classLabel = playerClass.getUserClass(entry.money)
    const viewerBadge = entry.id === viewerId ? " (you)" : ""
    return `${listIcon} #${entry.rank} ${entry.displayName}${viewerBadge} — ${formatMetricValue(metricId, entry)} • ${classLabel} • \`${momentum.signature}\``
}

const chunkFieldContent = (content, limit = MAX_EMBED_FIELD_LENGTH) => {
    if (!content || typeof content !== "string") {
        return []
    }
    const normalized = content.trim()
    if (!normalized) {
        return []
    }
    const chunks = []
    let remaining = normalized

    while (remaining.length > limit) {
        let breakpoint = remaining.lastIndexOf("\n", limit)
        if (breakpoint <= 0) {
            breakpoint = limit
        }
        const chunk = remaining.slice(0, breakpoint)
        if (chunk.trim().length > 0) {
            chunks.push(chunk)
        }
        remaining = remaining.slice(breakpoint)
        if (remaining.startsWith("\n")) {
            remaining = remaining.slice(1)
        }
    }

    if (remaining.trim().length > 0) {
        chunks.push(remaining)
    }

    return chunks
}

const appendChunkedField = (embed, label, content) => {
    const chunks = chunkFieldContent(content)
    chunks.forEach((chunk, index) => {
        embed.addFields({
            name: index === 0 ? label : `${label} (cont.)`,
            value: chunk
        })
    })
}

const buildComponents = (metricId, customId, { disabled = false } = {}) => {
    const rows = []
    if (metricDefinitions.length > 1) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder("Switch metric")
            .setDisabled(disabled)

        metricDefinitions.forEach((metric) => {
            const option = {
                label: `${metric.icon ? `${metric.icon} ` : ""}${metric.label}`.trim(),
                value: metric.id,
                default: metric.id === metricId
            }
            if (metric.description) {
                option.description = metric.description.slice(0, 95)
            }
            select.addOptions(option)
        })

        rows.push(new ActionRowBuilder().addComponents(select))
    }

    return rows
}

const buildEmptyEmbed = (metricId) => {
    const metric = metricMap[metricId]
    const title = metric ? `${metric.icon || "🏆"} ${metric.label}` : "🏆 Global Leaderboard"
    const description = leaderboardSettings.emptyState?.description
        || "Leaderboard data is not ready yet. Play a few hands to warm it up."
    const embed = new EmbedBuilder()
        .setColor(EMPTY_EMBED_COLOR)
        .setTitle(title)
        .setDescription(description)
    return embed
}

const buildLeaderboardEmbed = ({ metricId, entries, viewerId }) => {
    const metric = getMetricDefinition(metricId)
    const podiumSize = leaderboardSettings.podiumSize || 3
    const podiumEntries = entries.slice(0, podiumSize)
    const challengers = entries.slice(podiumSize)
    const embed = new EmbedBuilder()
        .setColor(metricId === "win-rate" ? Colors.Blurple : Colors.Gold)
        .setTitle(`🏆 Chipsy Global Leaderboard — ${metric?.label || "Elite"}`)
        .setDescription(metric?.description || "Top Chipsy players ranked by pure competitiveness.")

    if (podiumEntries.length) {
        const podiumBlock = podiumEntries.map((entry) => formatPodiumEntry(entry, metricId, viewerId)).join("\n\n")
        appendChunkedField(embed, "Podium", podiumBlock)
    }

    if (challengers.length) {
        const listBlock = challengers.map((entry) => formatChallengerEntry(entry, metricId, viewerId)).join("\n")
        appendChunkedField(embed, "Challengers", listBlock)
    }

    const viewerIndex = entries.findIndex((entry) => entry.id === viewerId)
    const footerText = viewerIndex >= 0
        ? `You are currently #${entries[viewerIndex].rank} on this board.`
        : `You are not yet in the top ${entries.length} — keep playing to climb.`
    embed.setFooter({ text: `${footerText} | Momentum blends XP, win rate & activity.` })

    return embed
}

const slashCommand = new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show the Chipsy global leaderboard.")
    .addStringOption(option => {
        option
            .setName("metric")
            .setDescription("Choose how to rank players.")
            .setRequired(false)

        metricDefinitions.forEach((metric) => {
            option.addChoices({
                name: `${metric.icon ? `${metric.icon} ` : ""}${metric.label}`.trim(),
                value: metric.id
            })
        })
        return option
    })

module.exports = createCommand({
    name: "leaderboard",
    description: "Show the Chipsy global leaderboard.",
    slashCommand,
    defer: true,
    deferEphemeral: false,
    errorMessage: "Unable to load the leaderboard right now. Please try again later.",
    execute: async(interaction, client) => {
        const dataHandler = client?.dataHandler ?? interaction.client?.dataHandler
        if (!dataHandler || typeof dataHandler.getLeaderboard !== "function") {
            await sendInteractionResponse(interaction, {
                content: "❌ Leaderboard service unavailable. Please try again later.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const runtimeClient = client ?? interaction.client
        const respond = (payload = {}) => sendInteractionResponse(interaction, payload)
        const requestedMetric = interaction.options.getString("metric")
        const metricId = metricMap[requestedMetric] ? requestedMetric : defaultMetricId
        const viewerId = interaction.user?.id
        const limit = leaderboardSettings.entries || 10
        const selectCustomId = `${selectIdPrefix}:${interaction.id}`

        const buildResponse = async(currentMetric) => {
            const dataset = await dataHandler.getLeaderboard({
                metric: currentMetric,
                limit
            })
            const items = Array.isArray(dataset?.items) ? dataset.items : []

            if (!items.length) {
                return {
                    embed: buildEmptyEmbed(currentMetric),
                    components: buildComponents(currentMetric, selectCustomId)
                }
            }

            const enriched = await decorateEntries(runtimeClient, items)
            return {
                embed: buildLeaderboardEmbed({
                    metricId: currentMetric,
                    entries: enriched,
                    viewerId
                }),
                components: buildComponents(currentMetric, selectCustomId)
            }
        }

        let stateMetric = metricId
        let payload
        try {
            payload = await buildResponse(stateMetric)
        } catch (error) {
            logger.error("Failed to build leaderboard payload", {
                scope: "commands.leaderboard",
                metric: stateMetric,
                error: error?.message
            })
            await sendInteractionResponse(interaction, {
                content: "❌ Unable to load the leaderboard. Please try again shortly.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const message = await respond({
            embeds: [payload.embed],
            components: payload.components
        })

        if (!message || metricDefinitions.length <= 1) {
            return
        }

        const selectFilter = withAccessGuard(
            (componentInteraction) => componentInteraction.customId === selectCustomId,
            { scope: "leaderboard:metricSelect" }
        )
        const collector = message.createMessageComponentCollector({
            filter: selectFilter,
            time: interactionTimeoutMs
        })

        collector.on("collect", async(componentInteraction) => {
            if (componentInteraction.user?.id !== viewerId) {
                await componentInteraction.reply({
                    content: "Only the challenger who opened this leaderboard can switch metrics.",
                    flags: MessageFlags.Ephemeral
                }).catch(() => {})
                return
            }

            const picked = Array.isArray(componentInteraction.values) ? componentInteraction.values[0] : null
            const nextMetric = metricMap[picked] ? picked : stateMetric
            if (nextMetric === stateMetric) {
                await componentInteraction.deferUpdate().catch(() => {})
                return
            }

            try {
                await componentInteraction.deferUpdate()
            } catch (error) {
                logger.warn("Failed to defer leaderboard select interaction", {
                    scope: "commands.leaderboard",
                    error: error?.message
                })
                return
            }

            try {
                const updated = await buildResponse(nextMetric)
                await interaction.editReply({
                    embeds: [updated.embed],
                    components: updated.components
                })
                stateMetric = nextMetric
            } catch (error) {
                logger.error("Failed to refresh leaderboard view", {
                    scope: "commands.leaderboard",
                    metric: nextMetric,
                    error: error?.message
                })
                await interaction.followUp({
                    content: "❌ Unable to refresh the leaderboard. Please try again.",
                    flags: MessageFlags.Ephemeral
                }).catch(() => {})
            }
        })

        collector.on("end", async() => {
            try {
                const disabled = buildComponents(stateMetric, selectCustomId, { disabled: true })
                await interaction.editReply({
                    components: disabled
                })
            } catch (error) {
                logger.warn("Failed to disable leaderboard selector", {
                    scope: "commands.leaderboard",
                    error: error?.message
                })
            }
        })
    }
})
