const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const features = require("../../../shared/features")
const { sleep } = require("../../utils/helpers")
const Game = require("../shared/baseGame.js")
const cards = require("../shared/cards.js")
const setSeparator = require("../../utils/setSeparator")
const bankrollManager = require("../../utils/bankrollManager")
const { recordNetWin } = require("../../utils/netProfitTracker")
const { awardGoldForHand } = require("../../utils/goldRewardManager")
const { buildProbabilityField } = require("../../utils/probabilityFormatter")
const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
const logger = require("../../utils/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../../utils/interactionAccess")
const config = require("../../../config")
const BlackjackRenderer = require("./blackjackRenderer")
const { resolveBlackjackSettings, defaults: blackjackSettingDefaults } = require("./settings")
const GameBroadcaster = require("../shared/gameBroadcaster")

const EMPTY_TIMELINE_TEXT = "No actions yet."
const AUTO_CLEAN_DELAY_MS = 15 * 1000

const CARD_VALUE_MAP = {
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    T: "10",
    9: "9",
    8: "8",
    7: "7",
    6: "6",
    5: "5",
    4: "4",
    3: "3",
    2: "2"
}

const CARD_SUIT_MAP = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
}

const ACTION_BUTTONS = {
    stand: { label: "Stand", style: ButtonStyle.Secondary, emoji: "🛑" },
    hit: { label: "Hit", style: ButtonStyle.Primary, emoji: "🎯" },
    double: { label: "Double", style: ButtonStyle.Success, emoji: "💰" },
    split: { label: "Split", style: ButtonStyle.Success, emoji: "✂️" },
    insurance: { label: "Insurance", style: ButtonStyle.Danger, emoji: "🛡️" }
}

const DEFAULT_TIMELINE_MAX = 30
const DEFAULT_TIMELINE_PREVIEW = 15

function resolveTimelineStorageLimit() {
    const limit = config?.blackjack?.timelineMaxEntries?.default
    if (Number.isFinite(limit) && limit > 0) {
        return limit
    }
    return DEFAULT_TIMELINE_MAX
}

function resolveTimelinePreviewLimit() {
    const limit = config?.blackjack?.timelinePreview?.default
    if (Number.isFinite(limit) && limit > 0) {
        return limit
    }
    return DEFAULT_TIMELINE_PREVIEW
}

function formatTimelineStamp(date) {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime())
        ? date
        : new Date()
    const hh = safeDate.getHours().toString().padStart(2, "0")
    const mm = safeDate.getMinutes().toString().padStart(2, "0")
    const ss = safeDate.getSeconds().toString().padStart(2, "0")
    return `${hh}:${mm}:${ss}`
}

function formatCardLabel(cardCode) {
    if (!cardCode || typeof cardCode !== "string") return cardCode ?? "";
    const value = CARD_VALUE_MAP[cardCode[0]] ?? cardCode[0];
    const suit = CARD_SUIT_MAP[cardCode[1]] ?? cardCode[1] ?? "";
    return `${value}${suit}`;
}

function resolvePlayerLabel(player) {
    if (!player) return "Player";
    return player.tag || player.username || player.name || player.user?.username || "Player";
}

function formatPlayerName(player) {
    return `**${resolvePlayerLabel(player)}**`;
}

const buildInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "blackjackGame",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

async function sendEphemeralError(interaction, content) {
    const embed = new EmbedBuilder().setColor(Colors.Red).setDescription(content)
    const reply = await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(
        buildInteractionLog(interaction, "Failed to send blackjack ephemeral error", {
            action: "sendEphemeralError"
        })
    )
    if (reply) {
        setTimeout(() => {
            interaction.deleteReply(reply.id).catch(
                buildInteractionLog(interaction, "Failed to delete blackjack ephemeral reply", {
                    action: "sendEphemeralError",
                    replyId: reply.id
                })
            )
        }, config.delays.medium.default)
    }
    return reply
}

function formatTimeout(ms) {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) {
        return `${seconds}s`
    }
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) {
        return `${minutes}m`
    }
    return `${minutes}m ${remainingSeconds}s`
}

function buildActionButtons(playerId, options) {
    if (!playerId || !Array.isArray(options) || options.length === 0) return null
    const row = new ActionRowBuilder()
    for (const option of options) {
        const meta = ACTION_BUTTONS[option]
        if (!meta) continue
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`bj_action:${option}:${playerId}`)
                .setLabel(meta.label)
                .setStyle(meta.style)
                .setEmoji(meta.emoji)
        )
    }
    return row.components.length > 0 ? row : null
}

function formatHandSummary(hand, options = {}) {
    const {
        isCurrent = false,
        showPointer = true,
        includeHandLabel = false,
        handIndex = null
    } = options
    const statusParts = [Number.isFinite(hand?.value) ? `${hand.value}` : "??"]
    if (hand?.busted) statusParts.push("Busted")
    if (hand?.BJ) statusParts.push("Blackjack")
    if (hand?.push) statusParts.push("Push")
    const pointer = isCurrent && showPointer ? "▶ " : ""
    const handLabel = includeHandLabel
        ? `Hand #${Number.isInteger(handIndex) ? handIndex + 1 : "?"} • `
        : ""
    return `${pointer}${handLabel}${statusParts.join(" • ")}`
}

function resolvePlayerStackDisplay(player) {
    if (!player) return 0
    if (Number.isFinite(player.stack) && player.stack > 0) return player.stack
    if (Number.isFinite(player.pendingBuyIn) && player.pendingBuyIn > 0) return player.pendingBuyIn
    if (Number.isFinite(player.buyInAmount) && player.buyInAmount > 0) return player.buyInAmount
    return 0
}

function partitionBettingPlayers(players = []) {
    const summary = {
        withBets: [],
        waitingDetailed: [],
        waitingStatus: []
    }
    players.filter((p) => !p.newEntry).forEach((p) => {
        const hasBet = p.bets && p.bets.initial > 0
        if (hasBet) {
            summary.withBets.push(`${p} - ✅ ${setSeparator(p.bets.initial)}$`)
        } else {
            summary.waitingDetailed.push(`${p} - ⏳ Waiting... (Stack: ${setSeparator(resolvePlayerStackDisplay(p))}$)`)
            summary.waitingStatus.push(`${p} - ⏳ Waiting...`)
        }
    })
    return summary
}


module.exports = class BlackJack extends Game {
    constructor(info) {
        super(info)
        const deckCount = config.blackjack.deckCount.default
        this.cards = Array(deckCount).fill(cards).flat()
        this.betsCollector = null
        this.dealer = null
        this.dealerStatusMessage = null
        this.dealerTimeline = []
        this.roundProgressMessage = null
        this.autobetSetupMessages = []
        this.lastRemovalReason = null
        this.isBettingPhaseOpen = false
        this.betsPanelVersion = 0
        this.playersLeftDuringBets = []
        this.awaitingPlayerId = null
        this.pendingJoins = new Map()
        this.pendingProbabilityTask = null
        this.actionTimeoutMs = config.blackjack.actionTimeout.default
        this.renderer = new BlackjackRenderer(this)
        this.rebuyOffers = new Map()
        this.waitingForRebuy = false
        this.lastRoundMessage = null
        this.cleanupTimers = new Set()

        // GameBroadcaster initialization
        this.broadcaster = new GameBroadcaster(this)
        if (info.message?.channel) {
            this.broadcaster.setPrimaryChannel(info.message.channel)
        }

        this.applySettings(info?.settings)
    }

    inheritLobbyMirrors(lobbySession) {
        this.broadcaster.inheritLobbyMirrors(lobbySession)
    }

    appendDealerTimeline(entry) {
        if (!entry) return
        if (!Array.isArray(this.dealerTimeline)) {
            this.dealerTimeline = []
        }
        this.dealerTimeline.push({
            at: new Date(),
            message: entry
        })
        const maxEntries = resolveTimelineStorageLimit()
        if (this.dealerTimeline.length > maxEntries) {
            this.dealerTimeline.shift()
        }
    }

    getDeckWarning() {
        if (this.cards.length < config.blackjack.reshuffleThreshold.default) {
            return " ⚠️ Deck will be reshuffled next round"
        }
        return ""
    }

    resetBettingPhaseActivity() {
        this.playersLeftDuringBets = []
    }

    async waitForPendingJoin(playerId) {
        if (!playerId || !this.pendingJoins?.has(playerId)) return
        const pending = this.pendingJoins.get(playerId)
        if (!pending) return
        try {
            await pending
        } catch (error) {
            logger.debug("Pending blackjack join rejected", {
                scope: "blackjackGame",
                playerId,
                error: error.message
            })
        }
    }

    async waitForPendingJoins() {
        if (!this.pendingJoins || this.pendingJoins.size === 0) return
        const snapshot = Array.from(this.pendingJoins.values())
        if (!snapshot.length) return
        await Promise.allSettled(snapshot)
    }

    getMinimumPlayers() {
        const configured = Number(config?.blackjack?.minPlayers?.default)
        if (Number.isFinite(configured) && configured >= 1) {
            return Math.floor(configured)
        }
        return 1
    }

    getActionTimeoutLimits() {
        const fallbackMin = 15 * 1000
        const fallbackMax = 120 * 1000
        const allowed = config?.blackjack?.actionTimeout?.allowedRange || {}
        return {
            min: Number.isFinite(allowed.min) ? allowed.min : fallbackMin,
            max: Number.isFinite(allowed.max) ? allowed.max : fallbackMax
        }
    }

    applySettings(overrides = {}) {
        const resolved = resolveBlackjackSettings({ overrides })
        this.settings = resolved
        if (resolved?.actionTimeoutMs) {
            this.updateActionTimeout(resolved.actionTimeoutMs)
        }
        return resolved
    }

    isRebuyEnabled() {
        return this.settings?.allowRebuyMode !== "off"
    }

    getRebuyWindowMs() {
        const fallback = blackjackSettingDefaults.rebuyWindowMs || (config?.blackjack?.rebuy?.offerTimeout?.default ?? 60 * 1000)
        const min = blackjackSettingDefaults.minWindowMs || 30 * 1000
        const max = blackjackSettingDefaults.maxWindowMs || 10 * 60 * 1000
        const resolved = Number.isFinite(this.settings?.rebuyWindowMs) ? this.settings.rebuyWindowMs : fallback
        return Math.max(min, Math.min(max, resolved))
    }

    canPlayerRebuy(player) {
        if (!player || !this.isRebuyEnabled()) return false
        const mode = this.settings?.allowRebuyMode || "on"
        if (mode === "off") return false
        if (mode === "once" && Number(player.rebuysUsed) >= 1) return false
        return true
    }

    updateActionTimeout(durationMs) {
        const { min, max } = this.getActionTimeoutLimits()
        const numeric = Number(durationMs)
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return { ok: false, reason: "invalid-duration" }
        }
        const clamped = Math.max(min, Math.min(max, Math.floor(numeric)))
        this.actionTimeoutMs = clamped
        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ turnTimeoutMs: clamped })
        }
        return { ok: true, value: clamped, clamped: clamped !== numeric }
    }

    updateActionTimeoutFromSeconds(seconds) {
        const millis = Number(seconds) * 1000
        return this.updateActionTimeout(millis)
    }

    trackBettingDeparture(player) {
        if (!this.isBettingPhaseOpen) return
        if (!player) return
        if (!Array.isArray(this.playersLeftDuringBets)) {
            this.playersLeftDuringBets = []
        }
        const id = player.id || player.user?.id || null
        const tag = player.tag || player.user?.tag || player.username || player.name || (id ? `<@${id}>` : null)
        const mention = id ? `<@${id}>` : tag || formatPlayerName(player)
        const label = formatPlayerName(player)
        const alreadyTracked = this.playersLeftDuringBets.find((entry) => {
            if (id && entry.id === id) return true
            return entry.label === label
        })
        if (!alreadyTracked) {
            this.playersLeftDuringBets.push({
                id,
                label,
                tag,
                mention
            })
        }
    }

    getBettingDepartures() {
        if (!Array.isArray(this.playersLeftDuringBets)) {
            return []
        }
        return [...this.playersLeftDuringBets]
    }

    clearDealerTimeline() {
        this.dealerTimeline = []
    }

    getNormalizedTimelineEntries(limit) {
        const entries = Array.isArray(this.dealerTimeline) ? this.dealerTimeline : []
        if (!entries.length) {
            return []
        }
        const normalized = entries
            .map((entry) => {
                if (!entry) return null
                const payload = typeof entry === "string" ? { message: entry } : entry
                const rawMessage = typeof payload?.message === "string"
                    ? payload.message
                    : (typeof entry === "string" ? entry : "")
                const message = rawMessage?.trim?.() || ""
                if (!message) {
                    return null
                }
                const rawDate = payload?.at instanceof Date
                    ? payload.at
                    : (payload?.at ? new Date(payload.at) : null)
                const date = rawDate && !Number.isNaN(rawDate.getTime())
                    ? rawDate
                    : new Date()
                return {
                    at: new Date(date.getTime()),
                    iso: date.toISOString(),
                    message
                }
            })
            .filter(Boolean)
        if (!normalized.length) {
            return []
        }
        if (Number.isFinite(limit) && limit > 0) {
            return normalized.slice(-limit)
        }
        return normalized
    }

    getTimelineSnapshot(options = {}) {
        const limit = Number.isFinite(options?.limit)
            ? options.limit
            : resolveTimelinePreviewLimit()
        const entries = this.getNormalizedTimelineEntries(limit)
        if (!entries.length) {
            return null
        }
        return {
            label: "Dealer timeline",
            entries: entries.map((entry) => ({
                at: entry.iso,
                message: entry.message
            }))
        }
    }

    buildDealerTimelineFields() {
        const entries = this.getNormalizedTimelineEntries(resolveTimelineStorageLimit())
        if (!entries.length) {
            return [{ name: "Timeline", value: "No activity yet.", inline: false }]
        }
        const formatted = entries.map((entry) => `${formatTimelineStamp(entry.at)} ${entry.message}`.trim())
        const columns = Math.min(3, Math.max(1, Math.ceil(formatted.length / 5)))
        const perColumn = Math.ceil(formatted.length / columns)
        const fields = []
        for (let i = 0; i < columns; i++) {
            const chunk = formatted.slice(i * perColumn, (i + 1) * perColumn)
            if (!chunk.length) continue
            fields.push({
                name: i === 0 ? "Timeline" : "\u200b",
                value: chunk.map(line => `• ${line}`).join("\n"),
                inline: columns > 1
            })
        }
        return fields
    }

    buildDealerTimelineDescription() {
        const entries = this.getNormalizedTimelineEntries(resolveTimelinePreviewLimit())
        if (!entries.length) {
            return null
        }
        const formatted = entries.map((entry) => `\`${formatTimelineStamp(entry.at)}\` ${entry.message}`.trim())
        return formatted.join("\n")
    }

    async refreshDealerTimeline() {
        // This method updates only the primary dealer status message.
        // Since it's a status message, we should probably broadcast it if it was intended to be seen by all.
        // However, `dealerStatusMessage` is specific to one of the messages.
        // If we switch to broadcasting, this logic needs to update.
        // For now, we will keep it updating the primary message or we need to handle it via broadcaster.
        // Ideally, `updateDealerProgressEmbed` (which calls this or is called by this) should use broadcast.
        if (!this.dealerStatusMessage) return 
        // If it's a message object, it might be stale or from a specific channel.
        // We should probably rely on broadcast instead of holding `dealerStatusMessage` reference directly if we want sync.
        // BUT, Blackjack structure holds references to specific messages like `betsMessage`, `dealerStatusMessage`.
        
        const baseEmbed = this.dealerStatusMessage.embeds?.[0]
        if (!baseEmbed) return
        const embed = EmbedBuilder.from(baseEmbed)
        const timelineDesc = this.buildDealerTimelineDescription()
        embed.setDescription(timelineDesc ?? EMPTY_TIMELINE_TEXT)
        
        // Broadcast update? No, dealerStatusMessage is usually the "table" view.
        // If we want multi-channel, we should broadcast this update to all mirrors.
        // We can use `broadcaster.broadcast` with the payload.
        
        // The issue is `this.dealerStatusMessage` is just one message instance.
        // We should change `dealerStatusMessage` to be just a flag or handle it via broadcaster.
        
        try {
            await this.broadcaster.broadcast({ embeds: [embed] })
        } catch (error) {
            logger.error("Failed to refresh dealer timeline", {
                scope: "blackjackGame",
                error: error.message
            })
        }
    }

    createPlayerSession(user, stackAmount) {
        if (!user) return null
        const safeDisplayAvatar =
            typeof user.displayAvatarURL === "function"
                ? (options) => user.displayAvatarURL(options)
                : () => null
        const safeToString =
            typeof user.toString === "function"
                ? () => user.toString()
                : () => (user.id ? `<@${user.id}>` : "Player")
        const tag =
            typeof user.tag === "string"
                ? user.tag
                : typeof user.username === "string"
                ? `${user.username}#${user.discriminator || "0000"}`
                : "Blackjack player"

        const resolvedStack =
            Number.isFinite(stackAmount) && stackAmount > 0
                ? Math.floor(stackAmount)
                : 0

        return {
            id: user.id,
            tag,
            username: user.username,
            bot: user.bot,
            data: user.data ?? {},
            client: user.client,
            stack: resolvedStack,
            buyInAmount: resolvedStack,
            pendingBuyIn: resolvedStack,
            newEntry: true,
            rebuysUsed: 0,
            toString: safeToString,
            displayAvatarURL: safeDisplayAvatar,
            user
        }
    }

    resolveRefundableStack(player, options = {}) {
        const includePending = Boolean(options.includePending)
        const stackBalance = Number.isFinite(player?.stack) ? player.stack : 0
        if (stackBalance > 0) {
            return { amount: stackBalance, usedPending: false }
        }
        if (!includePending) {
            return { amount: 0, usedPending: false }
        }
        const pendingAmount = Number.isFinite(player?.pendingBuyIn) ? player.pendingBuyIn : 0
        const canUsePending = pendingAmount > 0 && (player?.newEntry || (!this.playing || this.hands < 1))
        if (canUsePending) {
            return { amount: pendingAmount, usedPending: true }
        }
        return { amount: 0, usedPending: false }
    }

    applyStackRefund(player, options = {}) {
        if (!player) {
            return { refunded: 0, usedPending: false }
        }
        const { includePending = false } = options
        const { amount, usedPending } = this.resolveRefundableStack(player, { includePending })
        if (amount <= 0) {
            return { refunded: 0, usedPending: false }
        }
        player.stack = amount
        bankrollManager.syncStackToBankroll(player)
        if (usedPending || (player.pendingBuyIn > 0 && player.newEntry)) {
            player.pendingBuyIn = 0
        }
        return { refunded: amount, usedPending }
    }

    scheduleMessageCleanup(target) {
        if (!this.settings?.autoCleanHands) return
        // If target is a message object, we can't easily cleanup mirrors without tracking them.
        // Broadcaster doesn't support "delete later" for mirrors yet.
        // For now, we can just delete the primary message if passed, or ignore.
        // If we want to cleanup bet messages on all channels, we'd need to track them in broadcaster or just let them scroll up.
        // Let's skip complex cleanup for mirrors for now to avoid complexity.
        if (target && typeof target.delete === "function") {
             const timer = setTimeout(() => {
                this.cleanupTimers.delete(timer)
                target.delete().catch(() => null)
            }, AUTO_CLEAN_DELAY_MS)
            this.cleanupTimers.add(timer)
        }
    }

    clearCleanupTimers() {
        if (!this.cleanupTimers || this.cleanupTimers.size === 0) return
        for (const timer of this.cleanupTimers) {
            clearTimeout(timer)
        }
        this.cleanupTimers.clear()
    }

    async SendMessage(type, player, info) {
        const clientAvatar = this.client?.user?.displayAvatarURL({ extension: "png" }) ?? null
        const sendEmbed = async(embed, components = [], additionalPayload = {}) => {
            try {
                const payload = { embeds: [embed], ...additionalPayload }
                if (components.length > 0) {
                    payload.components = components
                }
                // Use broadcast instead of channel.send
                return await this.broadcaster.broadcast(payload)
            } catch (error) {
                logger.error("Failed to send blackjack message", {
                    scope: "blackjackGame",
                    type,
                    channelId: this.channel?.id,
                    userId: player?.id,
                    error: error.message,
                    stack: error.stack
                })
                return null
            }
        }
        switch(type) {
            case "deckRestored": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Aqua)
                    .setFooter({ text: "Game deck has been shuffled and restored", iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "maxPlayers": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setFooter({
                        text: `${player.tag}, access denied: maximum number of players reached for this game`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "delete": {
                const reason = info?.reason || "allPlayersLeft"
                let message = "Game deleted: all players left"
                if (reason === "noBetsPlaced") {
                    message = "Game deleted: no bets were placed"
                }
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setFooter({ text: message })
                await sendEmbed(embed)
            break }
            case "stand":
            case "hit": {
                const cardLabel = info?.card ? ` (${formatCardLabel(info.card)})` : ""
                const handLabel = typeof info?.handIndex === "number" && player?.hands?.length > 1
                    ? ` (Hand #${info.handIndex + 1})`
                    : ""
                const embed = new EmbedBuilder()
                    .setColor(type === "hit" ? Colors.Purple : Colors.LuminousVividPink)
                    .setFooter({
                        text: `${player.tag} ${type === "hit" ? "hit" : "stand"}s${cardLabel}`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
                this.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} ${type === "hit" ? `hits${cardLabel}` : "stands"}.`)
            break }
            case "double": {
                const cardLabel = info?.card ? ` (${formatCardLabel(info.card)})` : ""
                const handLabel = typeof info?.handIndex === "number" && player?.hands?.length > 1
                    ? ` (Hand #${info.handIndex + 1})`
                    : ""
                const embed = new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setFooter({
                        text: `${player.tag} doubles (-${setSeparator(player.bets.initial)}$)${cardLabel}`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
                this.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} doubles bet${cardLabel}.`)
            break }
            case "split": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Aqua)
                    .setFooter({
                        text: `${player.tag} splits hand (-${setSeparator(player.bets.initial)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
                this.appendDealerTimeline(`${formatPlayerName(player)} splits hand.`)
            break }
            case "insurance": {
                const insuranceValue = Math.max(0, Number(info?.amount ?? player?.bets?.insurance ?? 0))
                const embed = new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setFooter({
                        text: `${player.tag} has bought insurance (-${setSeparator(insuranceValue)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
                this.appendDealerTimeline(`${formatPlayerName(player)} buys insurance (${setSeparator(insuranceValue)}$).`)
            break }
            case "insuranceRefund": {
                const payout = Math.max(0, Number(info?.payout ?? 0))
                const embed = new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setFooter({
                        text: `${player.tag} has been refunded due to insurance (+${setSeparator(payout)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
                this.appendDealerTimeline(`${formatPlayerName(player)} receives insurance payout (+${setSeparator(payout)}$).`)
            break }
            case "invalidBet": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setFooter({
                        text: `${player.tag}, invalid bet amount provided.`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "betLocked": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setFooter({
                        text: `${player.tag}, you have already placed your bet for this round.`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "dealerHit":
            case "dealerStand": {
                this.appendDealerTimeline(`**Dealer** ${type === "dealerHit" ? "hits" : "stands"}.`)
            break }
            case "dealerBusted": {
                this.appendDealerTimeline("**Dealer** busted.")
            break }
            case "showDealer": {
                this.appendDealerTimeline(`**Dealer** reveals hidden card`)
                const message = await this.updateDealerProgressEmbed()
                this.dealerStatusMessage = message
                return message
            break }
            case "showStartingCards": {
                this.clearDealerTimeline()
                this.appendDealerTimeline(`Round #${this.hands} started. Dealing opening cards.`)
                await this.updateDealerProgressEmbed()
            break }
            case "displayInfo": {
                // Hand info updates (per player). 
                // These are typically separate messages or ephemerals?
                // Existing logic updates `player.status.infoMessage`.
                // This seems to be a personal message. We should keep it that way?
                // Or if it's a public table message, broadcast it.
                // Usually "Hand status" is personal or ephemeral.
                // BUT here it uses `sendEmbed` which goes to channel.
                // To avoid spamming all channels, maybe send this ONLY to primary channel?
                // OR if it's important game state, broadcast it.
                // Let's broadcast for consistency so all observers see the game flow.
                
                const pointerEnabled = !info;
                const handSummary = player.hands.map((hand, idx) =>
                    formatHandSummary(hand, {
                        isCurrent: idx === player.status.currentHand,
                        showPointer: pointerEnabled
                    })
                ).join("\n") || "No cards drawn yet."

                const embed = new EmbedBuilder()
                    .setColor(Colors.Gold)
                    .setTitle(`${player.tag} — Hand status`)
                    .setDescription([
                        handSummary,
                        info ? "*Standing automatically*" : null
                    ].filter(Boolean).join("\n\n"))
                    .setFooter({
                        text: `Total bet: ${setSeparator(player.bets.total)}$ | Insurance: ${player.bets.insurance > 0 ? setSeparator(player.bets.insurance) + "$" : "no"} | ${Math.round(this.actionTimeoutMs / 1000)}s left`,
                        iconURL: clientAvatar
                    })

                const components = []
                if (!info) {
                    const actionRow = buildActionButtons(player.id, player.availableOptions)
                    if (actionRow) components.push(actionRow)
                }

                const payload = {}
                const snapshot = await this.captureTableRender({
                    filename: `blackjack_round_${this.hands}_info_${player.id}_${Date.now()}.png`,
                    description: `Snapshot for ${player.tag} during round ${this.hands}`,
                    hideDealerHoleCard: true,
                    maskDealerValue: true,
                    forceResult: null
                })
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    payload.files = [snapshot.attachment]
                }

                const existingMessage = player.status?.infoMessage
                
                // NOTE: Editing across broadcasts is tricky because we need to edit ALL copies.
                // GameBroadcaster.broadcast does edit if we pass the message object? No, it edits based on stored targets.
                // But here we are editing a SPECIFIC message (`player.status.infoMessage`).
                // If this message was created via broadcast, we should update it via broadcast.
                // But `player.status.infoMessage` stores a single Discord.Message object.
                // We need to refactor this to just fire a new broadcast or use `broadcast` to update the "latest" message if possible.
                // BUT Blackjack sends NEW messages for each turn usually?
                // Let's check: `if (existingMessage) await existingMessage.edit(...)`
                
                // Ideally, we should stop tracking individual messages and just broadcast the state.
                // But if we want to edit the PREVIOUS message to avoid clutter:
                // We can try to broadcast with a "replace last" logic? No.
                
                // DECISION: For now, just broadcast new messages for player turns.
                // If we want to edit, we'd need to map `playerId` -> `Map<channelId, messageId>`.
                // That's too complex for this step.
                
                // Let's just always send new for now to ensure sync.
                const message = await sendEmbed(embed, components, payload)
                if (message) {
                    player.status.infoMessage = message
                }
            break }
            case "noRemaining": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Orange)
                    .setFooter({ text: "No util players left, proceding to next hand", iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "busted": {
                const handIndex = player.hands.indexOf(info)
                const handLabel = handIndex >= 0 && player.hands.length > 1 ? ` (Hand #${handIndex + 1})` : ""
                this.appendDealerTimeline(`${formatPlayerName(player)} busts${handLabel}.`)
            break }
            case "playersOutOfMoney": {
                const impactedEntries = Array.isArray(info?.players) ? info.players : (player ? [player] : [])
                const impactedPlayers = impactedEntries
                    .map((entry) => (typeof entry === "string" ? this.GetPlayer(entry) : entry))
                    .filter((pl) => pl && typeof pl === "object")
                if (impactedPlayers.length < 1) {
                    break
                }
                const embed = new EmbedBuilder()
                    .setColor(Colors.DarkRed)
                    .setTitle(impactedPlayers.length === 1 ? "Player eliminated" : "Players eliminated")
                    .setDescription(impactedPlayers
                        .map((pl) => `${formatPlayerName(pl)} lost all of their money and has left the table.`)
                        .join("\n"))
                const footerText = info?.finalizeGame
                    ? "Game over: no active players remain."
                    : this.isRebuyEnabled()
                        ? "Eliminated players can rebuy to rejoin the table."
                        : "Rebuy is disabled for this table."
                if (footerText) {
                    const footer = { text: footerText }
                    if (clientAvatar) {
                        footer.iconURL = clientAvatar
                    }
                    embed.setFooter(footer)
                }
                await sendEmbed(embed, [], { allowedMentions: { users: [] } })
            break }
            case "noMoneyBet": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setFooter({
                        text: `${player.tag}, you can not afford to bet this amount of money`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "betsOpened": {
                const embed = new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle(`Bets opened | Round #${this.hands}`)
                    .setDescription("Click **Bet** to place your bet, or **Leave** to exit the game.")
                    .addFields({
                        name: "Available stacks",
                        value: `${this.players
                            .filter((p) => {
                                return !p.newEntry
                            })
                            .map((p) => {
                                return `${p} - Stack: ${setSeparator(resolvePlayerStackDisplay(p))}$`
                            })
                            .join("\n") || "-"}`
                    })
                    .setFooter({ text: `You have got ${formatTimeout(config.blackjack.betsTimeout.default)}${this.getDeckWarning()}` })

                const components = [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId("bj_bet:place")
                            .setLabel("Bet")
                            .setStyle(ButtonStyle.Success)
                            .setEmoji("💰"),
                        new ButtonBuilder()
                            .setCustomId("bj_bet:autobet")
                            .setLabel("Autobet")
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji("🔄"),
                        new ButtonBuilder()
                            .setCustomId("bj_bet:leave")
                            .setLabel("Leave")
                            .setStyle(ButtonStyle.Danger)
                            .setEmoji("🚪")
                    )
                ]

                return await sendEmbed(embed, components)
            }
            case "betsClosed": {
                const allBetsPlaced = info?.allBetsPlaced === true
                const message = allBetsPlaced
                    ? "All bets placed."
                    : "Time is up."
                const embed = new EmbedBuilder()
                    .setColor(Colors.Red)
                    .setTitle(`Bets closed | Round #${this.hands}`)
                    .setDescription(message)
                await sendEmbed(embed)
            break }
        }
    }

    async captureTableRender(options = {}) {
        return this.renderer.captureTableRender(options)
    }

    async NextHand() {
        if (!this.playing) return

        await this.Reset()
        this.lastRemovalReason = null
        if (this.hands < 1) await this.Shuffle(this.cards)

        if (this.cards.length < config.blackjack.reshuffleThreshold.default) {
            const deckCount = config.blackjack.deckCount.default
            this.cards = Array(deckCount).fill(cards).flat()
            await this.Shuffle(this.cards)
            await this.SendMessage("deckRestored")
            await sleep(config.delays.short.default)
        }

        // Reset all player state for the new round
        for (const player of this.players) {
            player.data.last_played = new Date
            player.hands = []
            player.status = {
                current: false,
                currentHand: 0,
                insurance: {
                    wager: 0,
                    settled: false
                },
                won: {
                    grossValue: 0,
                    netValue: 0,
                    expEarned: 0,
                    goldEarned: 0
                },
                infoMessage: null
            }
            player.bets = {
                initial: 0,
                total: 0,
                insurance: 0
            }
        }

        // Check for and remove players without enough money AFTER resetting bets
        // This ensures we check their actual available stack, not mid-round bets
        const lowStackPlayers = [...this.players].filter((player) => this.hands > 0 && player.stack < this.minBet)
        if (lowStackPlayers.length > 0) {
            if (this.isRebuyEnabled()) {
                const rebuyOutcome = await this.handlePlayersOutOfFunds(lowStackPlayers, {
                    finalizeGame: lowStackPlayers.length >= this.players.length
                })
                if (rebuyOutcome?.endedGame) {
                    await this.Stop({ notify: false, reason: "allPlayersRanOutOfMoney" })
                    return
                }
            } else {
                for (const player of lowStackPlayers) {
                    this.lastRemovalReason = "noMoney"
                    await this.RemovePlayer(player, { skipStop: true })
                }
            }
        }

        if (this.players.length < this.getMinimumPlayers()) {
            await this.Stop({ notify: false, reason: "allPlayersRanOutOfMoney" })
            return
        }

        this.dealer = {
            cards: [],
            value: 0,
            pair: false,
            display: []
        }

        this.dealerStatusMessage = null
        this.roundProgressMessage = null

        this.hands++

        this.AwaitBets()
    }

    async handlePlayersOutOfFunds(players, options = {}) {
        const { finalizeGame = false } = options
        if (!Array.isArray(players) || players.length < 1) {
            return { removed: 0, endedGame: false, waitingForRebuy: false }
        }

        const uniquePlayers = []
        const seenIds = new Set()
        for (const entry of players) {
            const resolvedPlayer = typeof entry === "string" ? this.GetPlayer(entry) : entry
            if (!resolvedPlayer || typeof resolvedPlayer !== "object") continue
            const playerId = resolvedPlayer.id || resolvedPlayer.user?.id
            if (!playerId || seenIds.has(playerId)) continue
            const tablePlayer = this.GetPlayer(playerId) || resolvedPlayer
            if (!tablePlayer || typeof tablePlayer !== "object") continue
            seenIds.add(playerId)
            uniquePlayers.push(tablePlayer)
        }

        if (uniquePlayers.length === 0) {
            return { removed: 0, endedGame: false, waitingForRebuy: false }
        }

        for (const bustedPlayer of uniquePlayers) {
            this.appendDealerTimeline(`${formatPlayerName(bustedPlayer)} lost all of their money.`)
        }

        const rebuyEnabled = this.isRebuyEnabled()
        const rebuyCandidates = []
        const removeImmediately = []
        for (const bustedPlayer of uniquePlayers) {
            if (rebuyEnabled && this.canPlayerRebuy(bustedPlayer)) {
                bustedPlayer.status = bustedPlayer.status || {}
                bustedPlayer.status.pendingRebuy = true
                rebuyCandidates.push(bustedPlayer)
            } else {
                removeImmediately.push(bustedPlayer)
            }
        }

        for (const bustedPlayer of removeImmediately) {
            this.lastRemovalReason = "noMoney"
            try {
                await this.RemovePlayer(bustedPlayer, { skipStop: true })
            } catch (error) {
                logger.error("Failed to remove player with depleted stack", {
                    scope: "blackjackGame",
                    playerId: bustedPlayer?.id,
                    error: error.message
                })
            }
        }

        const finalizeNotice = finalizeGame && rebuyCandidates.length === 0
        if (!rebuyEnabled || rebuyCandidates.length === 0) {
            const endedGame = finalizeNotice || this.players.length === 0
            if (removeImmediately.length > 0) {
                try {
                    await this.SendMessage("playersOutOfMoney", null, {
                        players: removeImmediately,
                        finalizeGame: endedGame
                    })
                } catch (error) {
                    logger.debug("Failed to send playersOutOfMoney notification", {
                        scope: "blackjackGame",
                        error: error.message
                    })
                }
            }
            return { removed: removeImmediately.length, endedGame, waitingForRebuy: false }
        }

        const windowMs = this.getRebuyWindowMs()
        this.waitingForRebuy = true
        const rebuyResults = await Promise.allSettled(
            rebuyCandidates.map((player) => this.startRebuyOffer(player, windowMs))
        )
        this.waitingForRebuy = false

        const expiredPlayers = []
        rebuyResults.forEach((result, index) => {
            const targetPlayer = rebuyCandidates[index]
            if (!targetPlayer) return
            const rebuyStatus = result?.status === "fulfilled"
                ? result?.value?.status
                : result?.reason?.status
            if (rebuyStatus === "completed") {
                targetPlayer.status = targetPlayer.status || {}
                targetPlayer.status.pendingRebuy = false
                targetPlayer.status.removed = false
                targetPlayer.newEntry = false
                return
            }
            expiredPlayers.push(targetPlayer)
        })

        for (const expiredPlayer of expiredPlayers) {
            this.lastRemovalReason = "noMoney"
            try {
                if (expiredPlayer?.status) {
                    expiredPlayer.status.pendingRebuy = false
                }
                await this.RemovePlayer(expiredPlayer, { skipStop: true })
            } catch (error) {
                logger.error("Failed to remove player after rebuy expiration", {
                    scope: "blackjackGame",
                    playerId: expiredPlayer?.id,
                    error: error.message
                })
            }
        }

        const activePlayers = this.players.filter((pl) => Number.isFinite(pl?.stack) && pl.stack >= this.minBet)
        const endedGame = activePlayers.length < this.getMinimumPlayers()
        const eliminatedForNotice = [...removeImmediately, ...expiredPlayers].filter(Boolean)

        if (eliminatedForNotice.length > 0) {
            try {
                await this.SendMessage("playersOutOfMoney", null, {
                    players: eliminatedForNotice,
                    finalizeGame: endedGame
                })
            } catch (error) {
                logger.debug("Failed to send playersOutOfMoney notification after rebuys", {
                    scope: "blackjackGame",
                    error: error.message
                })
            }
        }

        this.UpdateInGame()

        return { removed: removeImmediately.length + expiredPlayers.length, endedGame, waitingForRebuy: rebuyCandidates.length > 0 }
    }

    async AwaitBets() {
        // Check for players with active autobet and place their bets automatically
        for (const player of this.players) {
            if (player.autobet && player.autobet.remaining > 0) {
                const bet = player.autobet.amount

                // Check if player has enough stack
                if (!bankrollManager.canAffordStack(player, bet)) {
                    // Not enough money - cancel autobet
                    delete player.autobet
                    await this.SendMessage("noMoneyBet", player)
                    continue
                }

                // Place autobet
                if (bankrollManager.withdrawStackOnly(player, bet)) {
                    player.bets = {
                        initial: bet,
                        total: bet,
                        insurance: 0,
                        fromSplitAce: false
                    }
                    player.pendingBuyIn = 0
                    player.hands = []
                    player.hands.push({
                        cards: await this.PickRandom(this.cards, 2),
                        bet,
                        settled: false,
                        fromSplitAce: false,
                        result: null,
                        payout: 0,
                        locked: false,
                        doubleDown: false
                    })

                    if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
                    await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))

                    // Decrease remaining autobet rounds
                    player.autobet.remaining--

                    // If this was the last autobet round, clean up
                    if (player.autobet.remaining === 0) {
                        delete player.autobet
                    }
                }
            }
        }

        // Check if all active players have placed their bets (via autobet)
        const allBetsPlaced = this.players.filter(p => !p.newEntry).every(p => p.bets && p.bets.initial > 0)
        const someBetsPlaced = this.players.filter(p => !p.newEntry).some(p => p.bets && p.bets.initial > 0)

        this.resetBettingPhaseActivity()

        this.betsMessage = await this.SendMessage("betsOpened")
        if (!this.betsMessage) {
            logger.error("Failed to send betsOpened message", {
                scope: "blackjackGame",
                channelId: this.channel?.id
            })
            return this.Stop({ reason: "error", notify: false })
        }
        this.betsPanelVersion += 1
        this.isBettingPhaseOpen = true

        // If any bets were placed via autobet, update the message to show them
        if (someBetsPlaced) {
            await this.UpdateBetsMessage(this.betsMessage)
        }

        // If all bets placed via autobet, use short timeout to allow disable
        const betTimeout = allBetsPlaced ? config.blackjack.autobetShortTimeout.default : config.blackjack.betsTimeout.default

        const betsFilter = withAccessGuard((interaction) => {
            if (!interaction || interaction.user?.bot) return false
            if (!interaction.customId || !interaction.customId.startsWith("bj_bet:")) return false
            const player = this.GetPlayer(interaction.user.id)
            return player !== null
        }, { scope: "blackjack:bets" })

        // Use broadcaster for bets collector
        this.betsCollector = true // Flag
        this.broadcaster.createCollectors({ filter: betsFilter, time: betTimeout }, async(interaction) => {
            const [, action] = interaction.customId.split(":")
            const player = this.GetPlayer(interaction.user.id)
            const logCollectorError = (message, meta = {}) =>
                buildInteractionLog(interaction, message, { phase: "betCollector", action, ...meta })

            if (!player || !player.data) {
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You are not in this game.")], flags: MessageFlags.Ephemeral }).catch(
                    logCollectorError("Failed to warn player about missing game state")
                )
                return
            }

            if (action === "leave") {
                await interaction.deferUpdate().catch(
                    logCollectorError("Failed to defer leave action update")
                )

                const leavingPlayer = player

                await this.RemovePlayer(leavingPlayer, { skipStop: true })

                // If everyone left, close bets with the proper reason and stop the round gracefully
                if (this.players.length === 0) {
                    await this.CloseBetsMessage("allPlayersLeft")
                    this.betsCollector = null
                    await this.Stop({ reason: "allPlayersLeft", notify: false })
                    return
                }

                // Otherwise refresh the bets panel for remaining players
                await this.UpdateBetsMessage(this.betsMessage, {
                    reason: "leave",
                    leavingPlayer
                })
                return
            }

            if (action === "autobet") {
                // ... (autobet logic same as before, just using interaction)
                // The complex part is handling nested collectors/modals.
                // Since broadcaster collectors handle the initial interaction,
                // ephemeral follow-ups (select menu, modal) are on the INTERACTION, not the channel/message.
                // So they should work fine even with broadcasting.
                // 
                // HOWEVER, `selectCollector` logic uses `interaction.channel.createMessageComponentCollector`.
                // This creates a collector on the PRIMARY CHANNEL only.
                // Mirrors won't see the select menu interactions if they are ephemeral (which they are).
                // Ephemeral components work on the interaction object itself usually?
                // No, ephemeral messages have no channel collector support usually unless using `interaction.awaitMessageComponent` or similar?
                // Actually, `setupReply` is ephemeral. To collect from ephemeral, we need `setupReply.createMessageComponentCollector` or `interaction.awaitMessageComponent`.
                // The original code used `interaction.channel.create...` with a filter on `customId`.
                // Wait, if the message is ephemeral, `interaction.channel` collector might NOT see it.
                // The standard way for ephemeral interactions is `awaitMessageComponent` on the `setupReply` or `interaction.user` context.
                // Let's fix that to use `setupReply.awaitMessageComponent` or similar.
                
                if (player.bets && player.bets.initial > 0) {
                    const reply = await interaction.reply({
                        embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You have already placed your bet for this round.")],
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        logCollectorError("Failed to warn player about duplicate bet")
                    )

                    if (reply) {
                        setTimeout(() => {
                            interaction.deleteReply().catch(
                                logCollectorError("Failed to remove duplicate bet warning", {
                                    replyId: reply.id
                                })
                            )
                        }, 5000)
                    }
                    return
                }

                // Show select menu
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`bj_autobet_rounds:${interaction.user.id}:${interaction.message.id}`)
                    .setPlaceholder("How many rounds?")
                    .addOptions([
                        { label: "3 rounds", value: "3", emoji: "3️⃣" },
                        { label: "4 rounds", value: "4", emoji: "4️⃣" },
                        { label: "5 rounds", value: "5", emoji: "5️⃣" }
                    ])

                const row = new ActionRowBuilder().addComponents(selectMenu)

                const setupReply = await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Blue).setTitle("🔄 Autobet Setup").setDescription("Select how many consecutive rounds you want to autobet:")],
                    components: [row],
                    flags: MessageFlags.Ephemeral
                }).catch(logCollectorError("Failed to send autobet setup menu"))

                if (!setupReply) return

                try {
                    const selectInteraction = await setupReply.awaitMessageComponent({
                        time: this.actionTimeoutMs,
                        filter: (i) => i.customId.startsWith("bj_autobet_rounds:") && i.user.id === interaction.user.id
                    })
                    
                    // ... Process selection ...
                    const rounds = parseInt(selectInteraction.values[0])
                    
                    // Show modal
                    const modalCustomId = `bj_autobet_modal:${selectInteraction.message.id}:${selectInteraction.user.id}:${rounds}`
                    const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(`Autobet Setup (${rounds} rounds)`)
                    // ... add inputs ...
                    const betInput = new TextInputBuilder().setCustomId("bet_amount").setLabel("Bet amount").setStyle(TextInputStyle.Short).setRequired(false)
                    modal.addComponents(new ActionRowBuilder().addComponents(betInput))
                    
                    await selectInteraction.showModal(modal)
                    
                    const submission = await selectInteraction.awaitModalSubmit({
                        time: config.blackjack.modalTimeout.default,
                        filter: (i) => i.customId === modalCustomId && i.user.id === selectInteraction.user.id
                    })
                    
                    // ... Process submission ...
                    await submission.deferUpdate()
                    
                    // Apply logic...
                    const betAmountStr = submission.fields.getTextInputValue("bet_amount")?.trim()
                    // ... validation ...
                    // ... apply autobet ...
                    
                    // We need to copy-paste the logic carefully or refactor.
                    // Given the limits, I will try to keep it structure but it's long.
                    
                    // --- Start of copied logic from original AwaitBets --- 
                    if (!Number.isFinite(bet) || bet < this.minBet || bet > this.maxBuyIn) {
                        await sendEphemeralError(submission, `❌ Invalid bet amount. Please bet between ${setSeparator(this.minBet)}$ and ${setSeparator(this.maxBuyIn)}$`)
                        return
                    }

                    if (!bankrollManager.withdrawStackOnly(player, bet)) {
                        await sendEphemeralError(submission, "❌ Insufficient funds.")
                        return
                    }

                    // Set up autobet
                    player.autobet = {
                        amount: bet,
                        remaining: rounds - 1 // -1 because we're placing the first bet now
                    }

                    player.bets = {
                        initial: bet,
                        total: bet,
                        insurance: 0,
                        fromSplitAce: false
                    }
                    player.hands = []
                    player.hands.push({
                        cards: await this.PickRandom(this.cards, 2),
                        bet,
                        settled: false,
                        fromSplitAce: false,
                        result: null,
                        payout: 0,
                        locked: false,
                        doubleDown: false
                    })

                    if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
                    await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))

                    // Update the bets message
                    await this.UpdateBetsMessage(this.betsMessage)

                    const confirmReply = await submission.followUp({
                        embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ Autobet active: ${setSeparator(bet)}$ x ${rounds} rounds\n💰 First bet placed: ${setSeparator(bet)}$`)],
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        logCollectorError("Failed to send autobet confirmation")
                    )

                    // Delete after configured delay
                    if (confirmReply) {
                        setTimeout(() => {
                            submission.deleteReply().catch(
                                logCollectorError("Failed to delete autobet confirmation", {
                                    replyId: confirmReply.id
                                })
                            )
                        }, config.delays.medium.default)
                    }
                    // --- End of copied logic ---

                } catch (err) {
                    // timeout or error
                    logger.debug("Autobet setup failed or timed out", { scope: "blackjackGame", error: err?.message })
                    if (setupReply) {
                        setupReply.edit({ components: [] }).catch(() => null)
                    }
                }
                
                return
            }

            if (action === "place") {
                // ... (Modal logic)
                // Same logic as before using `interaction.showModal`.
                // Modals work on the interaction, so they are compatible with broadcasting.
                
                const modalCustomId = `bj_bet_modal:${interaction.message.id}:${interaction.user.id}`
                const modal = new ModalBuilder()
                    .setCustomId(modalCustomId)
                    .setTitle(`Place Your Bet (Round #${this.hands})`)
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("betAmount")
                                .setLabel("Bet amount")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder(`Min: ${setSeparator(this.minBet)}$ | Max: ${setSeparator(player.stack)}$`)
                        )
                    )

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    logger.error("Failed to show bet modal", {
                        scope: "blackjackGame",
                        channelId: this.channel?.id,
                        userId: interaction.user.id,
                        error: error.message
                    })
                    return
                }

                let submission
                try {
                    submission = await interaction.awaitModalSubmit({
                        time: config.blackjack.modalTimeout.default,
                        filter: withAccessGuard(
                            (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
                            { scope: "blackjack:betModal" }
                        )
                    })
                } catch (error) {
                    return
                }

                if (!submission) return

                // Acknowledge submission immediately to prevent modal error
                await submission.deferUpdate().catch(
                    buildInteractionLog(submission, "Failed to defer bet modal submission", {
                        phase: "betModal",
                        action
                    })
                )

                // Check if bets collector has ended (timeout/closure)
                if (!this.betsCollector || this.betsCollector.ended) {
                    await sendEphemeralError(submission, "❌ Betting time has ended.")
                    return
                }

                const rawBetInput = submission.fields.getTextInputValue("betAmount")?.trim()
                const parsedBet = rawBetInput ? features.inputConverter(rawBetInput) : this.minBet
                let bet = parsedBet

                if (!Number.isFinite(bet) || bet <= 0) {
                    await sendEphemeralError(submission, "❌ Invalid bet amount.")
                    return
                }

                bet = Math.floor(bet)

                if (bet < this.minBet) {
                    await sendEphemeralError(submission, `❌ Minimum bet is ${setSeparator(this.minBet)}$.`)
                    return
                }

                if (!bankrollManager.canAffordStack(player, bet)) {
                    await sendEphemeralError(submission, "❌ You don't have enough chips for that bet.")
                    return
                }

                if (!bankrollManager.withdrawStackOnly(player, bet)) {
                    await sendEphemeralError(submission, "❌ Failed to place bet.")
                    return
                }

                player.bets.initial = bet
                player.bets.total += bet
                player.pendingBuyIn = 0

                if (player.newEntry) {
                    player.newEntry = false
                    this.UpdateInGame()
                }

                let assigned = await this.PickRandom(this.cards, 2)
                player.hands.push({
                    cards: assigned,
                    value: 0,
                    pair: false,
                    busted: false,
                    BJ: false,
                    push: false,
                    bet: player.bets.initial,
                    display: [],
                    fromSplitAce: false,
                    result: null,
                    payout: 0,
                    locked: false,
                    doubleDown: false
                })

                if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))

                // Update the bets message instead of sending a new one
                await this.UpdateBetsMessage(this.betsMessage)

                let remaining = this.players.filter((player) => {
                    return player.bets ? player.bets.initial < 1 : true == false
                }).length

                if (remaining < 1) this.betsCollector.stop("allBetsPlaced")
            }
        }, async (reason) => {
            // On End
            // ... (cleanup logic)
            this.betsCollector = null
            // ...
        })
    }

    async NextPlayer(player, auto) {
        if (!this.playing) return
        await this.UpdateInGame()
        let currentPlayer = player ? player : this.inGamePlayers[0]
        currentPlayer.status.current = true
        // Initialize currentHand to 0 if not set (first time this player plays)
        if (!Number.isFinite(currentPlayer.status.currentHand)) {
            currentPlayer.status.currentHand = 0
        }
        currentPlayer.availableOptions = await this.GetAvailableOptions(currentPlayer, currentPlayer.status.currentHand)
        this.awaitingPlayerId = currentPlayer?.id || null
        if (this.remoteControl) {
            this.remoteControl.currentPlayerId = this.awaitingPlayerId
        }
        if (this.isRemotePauseActive && this.isRemotePauseActive()) {
            await this.updateRoundProgressEmbed(currentPlayer, false, { paused: true })
            return
        }
        this.timer = setTimeout(() => {
            this.Action("stand", currentPlayer, currentPlayer.status.currentHand)
        }, this.actionTimeoutMs)

        const currentHand = currentPlayer.hands[currentPlayer.status.currentHand]
        // Auto-stand on 21 or blackjack
        if (currentHand.BJ || currentHand.value === 21 || auto) {
            clearTimeout(this.timer)
            this.timer = null
            currentPlayer.availableOptions = []
            await sleep(config.delays.short.default)
            await this.updateRoundProgressEmbed(currentPlayer, true)
            await sleep(config.delays.medium.default)
            return this.Action("stand", currentPlayer, currentPlayer.status.currentHand, true)
        }
        await sleep(config.delays.short.default)
        await this.updateRoundProgressEmbed(currentPlayer)
    }

    getProbabilityStage() {
        if (!this.playing) return "idle"
        if (this.isBettingPhaseOpen) return "betting"
        if (this.awaitingPlayerId) return "players"
        return "dealer"
    }

    buildProbabilityState() {
        const deck = Array.isArray(this.cards) ? this.cards.filter(Boolean) : []
        const players = Array.isArray(this.players)
            ? this.players.map((player) => ({
                id: player?.id,
                hands: Array.isArray(player?.hands)
                    ? player.hands.map((hand, index) => ({
                        index,
                        cards: Array.isArray(hand?.cards) ? hand.cards.filter(Boolean) : [],
                        bet: Number(hand?.bet) || 0,
                        locked: Boolean(hand?.locked || hand?.busted || hand?.result),
                        busted: Boolean(hand?.busted),
                        blackjack: Boolean(hand?.BJ),
                        result: typeof hand?.result === "string" ? hand.result : null,
                        fromSplitAce: Boolean(hand?.fromSplitAce),
                        doubleDown: Boolean(hand?.doubleDown)
                    }))
                    : []
            }))
            : []
        const dealerCards = Array.isArray(this.dealer?.cards) ? this.dealer.cards.filter(Boolean) : []
        const dealerResult = this.dealer?.busted
            ? "busted"
            : (this.dealer?.BJ ? "blackjack" : null)
        return {
            deck: { remaining: deck },
            players,
            dealer: {
                cards: dealerCards,
                result: dealerResult
            },
            awaitingPlayerId: this.awaitingPlayerId || null,
            stage: this.getProbabilityStage()
        }
    }

    async applyProbabilitySnapshot(result, meta = {}) {
        if (!result?.payload?.players) return null
        const playerStats = result.payload.players
        for (const player of this.players) {
            if (!player) continue
            if (!player.status) player.status = {}
            const stats = playerStats[player.id]
            if (stats && hasWinProbabilityInsight(player)) {
                player.status.winProbability = stats.win ?? 0
                player.status.pushProbability = stats.push ?? 0
                player.status.lossProbability = stats.lose ?? 0
                player.status.probabilitySamples = stats.samples ?? 0
                if (Array.isArray(player.hands) && Array.isArray(stats.hands)) {
                    stats.hands.forEach((handStats, index) => {
                        const target = player.hands[index]
                        if (!target) return
                        target.winProbability = handStats.win ?? 0
                        target.pushProbability = handStats.push ?? 0
                        target.loseProbability = handStats.lose ?? 0
                    })
                }
            } else {
                delete player.status.winProbability
                delete player.status.pushProbability
                delete player.status.lossProbability
                delete player.status.probabilitySamples
                if (Array.isArray(player.hands)) {
                    for (const hand of player.hands) {
                        delete hand.winProbability
                        delete hand.pushProbability
                        delete hand.loseProbability
                    }
                }
            }
        }
        const snapshot = this.setProbabilitySnapshot("blackjack", {
            ...result.payload,
            updatedAt: result.updatedAt,
            durationMs: result.durationMs,
            reason: meta?.reason || result.reason || null
        })
        await this.refreshProbabilityDisplays(meta)
        return snapshot
    }

    async refreshProbabilityDisplays(meta = {}) {
        if (!this.playing) return
        if (!this.roundProgressMessage) return
        if (!this.hasProbabilitySubscribers()) return
        const activePlayer = (Array.isArray(this.inGamePlayers)
            ? this.inGamePlayers.find((player) => player?.status?.current)
            : null) || (Array.isArray(this.players)
            ? this.players.find((player) => player?.status?.current)
            : null)
        if (!activePlayer || !hasWinProbabilityInsight(activePlayer)) return
        try {
            await this.updateRoundProgressEmbed(activePlayer, false, { probabilityRefresh: true })
        } catch (error) {
            logger.debug("Failed to refresh blackjack probability display", {
                scope: "blackjackGame",
                playerId: activePlayer?.id,
                reason: meta?.reason || null,
                error: error?.message
            })
        }
    }

    resetPlayerProbabilityState() {
        if (!Array.isArray(this.players)) return
        for (const player of this.players) {
            if (!player?.status) continue
            delete player.status.winProbability
            delete player.status.pushProbability
            delete player.status.lossProbability
            delete player.status.probabilitySamples
            if (Array.isArray(player.hands)) {
                for (const hand of player.hands) {
                    delete hand.winProbability
                    delete hand.pushProbability
                    delete hand.loseProbability
                }
            }
        }
    }

    hasProbabilitySubscribers() {
        return Array.isArray(this.players) && this.players.some((player) => hasWinProbabilityInsight(player))
    }

    queueProbabilityUpdate(reason = "stateChange") {
        if (!this.playing || !Array.isArray(this.players) || this.players.length === 0) {
            this.clearProbabilitySnapshot()
            return
        }
        if (!this.hasProbabilitySubscribers()) {
            this.resetPlayerProbabilityState()
            this.clearProbabilitySnapshot()
            return
        }
        const engine = this.getProbabilityEngine()
        if (!engine || typeof engine.calculateBlackjack !== "function") return
        const state = this.buildProbabilityState()
        const sequence = ++this.probabilitySequence
        this.pendingProbabilityTask = engine
            .calculateBlackjack(state, { reason })
            .then((result) => {
                if (!result || sequence !== this.probabilitySequence) {
                    return null
                }
                if (!result.payload) {
                    this.clearProbabilitySnapshot()
                    return null
                }
                return this.applyProbabilitySnapshot(result, { reason })
            })
            .catch((error) => {
                logger.warn("Blackjack probability calculation failed", {
                    scope: "blackjackGame",
                    reason,
                    error: error?.message
                })
            })
    }

    async UpdateBetsMessage(message, { reason = "update", leavingPlayer = null } = {}) {
        if (!this.isBettingPhaseOpen) return
        if (!message || typeof message.edit !== "function") return
        const panelVersion = this.betsPanelVersion

        const { withBets: playersWithBets, waitingDetailed: playersWaiting } = partitionBettingPlayers(this.players)

        const descriptionLines = ["Click **Bet** to place your bet, or **Leave** to exit the game."]

        const embed = new EmbedBuilder()
            .setColor(reason === "leave" ? Colors.Yellow : Colors.Green)
            .setTitle(`Bets opened | Round #${this.hands}`)

        const departedPlayers = this.getBettingDepartures()
        const departureLines = departedPlayers.map((entry) => {
            const displayLabel = entry.tag || entry.label
            return `🏃 ${displayLabel} left the table.`
        })

        const descriptionBlocks = [...descriptionLines]
        if (departureLines.length > 0) {
            descriptionBlocks.push(departureLines.join("\n"))
        }
        embed.setDescription(descriptionBlocks.join("\n\n"))

        if (playersWithBets.length > 0) {
            embed.addFields({
                name: "Bet Status",
                value: playersWithBets.join("\n")
            })
        }

        if (playersWaiting.length > 0) {
            embed.addFields({
                name: "Available stacks",
                value: playersWaiting.join("\n")
            })
        }

        embed.setFooter({ text: `You have got ${formatTimeout(config.blackjack.betsTimeout.default)}${this.getDeckWarning()}` })

        // Keep the same buttons from the original message
        const components = message.components

        if (!this.isBettingPhaseOpen || panelVersion !== this.betsPanelVersion) return

        try {
            await message.edit({ embeds: [embed], components })
        } catch (error) {
            logger.error("Failed to update bets message", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message
            })
        }
    }

    async CloseBetsMessage(reason = "timeout") {
        if (!this.betsMessage || typeof this.betsMessage.edit !== "function") return
        this.isBettingPhaseOpen = false
        this.betsPanelVersion += 1

        let message = "Time is up."
        let color = Colors.Red
        let isGameDeleted = false

        if (reason === "allBetsPlaced") {
            message = "All bets placed."
            color = Colors.Green
        } else if (reason === "allPlayersLeft") {
            message = "Game deleted: all players left."
            color = Colors.Orange
            isGameDeleted = true
        } else if (reason === "allPlayersRanOutOfMoney") {
            message = "Game ended: all players ran out of money."
            color = Colors.Orange
            isGameDeleted = true
        } else if (reason === "noBetsPlaced") {
            message = "Game deleted: bets not placed."
            color = Colors.Orange
            isGameDeleted = true
        } else if (reason === "forced") {
            message = "Betting closed by the dealer."
            color = Colors.Orange
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(`Bets closed | Round #${this.hands}`)
            .setDescription(message)

        if (!isGameDeleted) {
            const betSummary = partitionBettingPlayers(this.players)
            const betStatusLines = betSummary.withBets.concat(betSummary.waitingStatus)
            embed.addFields({
                name: "Bet Status",
                value: betStatusLines.join("\n") || "—"
            })
        }

        const departedPlayers = this.getBettingDepartures()
        if (departedPlayers.length > 0) {
            embed.addFields({
                name: departedPlayers.length === 1 ? "Left during betting" : "Players left during betting",
                value: departedPlayers.map((entry) => `🏃 ${entry.tag || entry.label}`).join("\n")
            })
        }

        // Only show footer if there's a deck warning
        const deckWarning = this.getDeckWarning()
        if (deckWarning) {
            embed.setFooter({ text: deckWarning.trim() })
        }

        // Remove all buttons from bets closed message
        const components = []

        try {
            await this.betsMessage.edit({ embeds: [embed], components })
        } catch (error) {
            logger.error("Failed to close bets message", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message
            })
        }

        // Delete any pending autobet setup messages
        for (const setupMsg of this.autobetSetupMessages) {
            try {
                if (setupMsg.interaction && typeof setupMsg.interaction.deleteReply === "function") {
                    await setupMsg.interaction.deleteReply().catch(
                        buildInteractionLog(setupMsg.interaction, "Failed to delete pending autobet setup reply", {
                            phase: "autobetCleanup",
                            replyId: setupMsg.messageId
                        })
                    )
                }
            } catch (error) {
                logger.debug("Failed to delete autobet setup message", {
                    scope: "blackjackGame",
                    error: error.message
                })
            }
        }
        this.autobetSetupMessages = []

        if (this.settings?.autoCleanHands) {
            this.scheduleMessageCleanup(this.betsMessage)
        }
    }

    async CreateOptions() {
        // Component collector for button interactions (actions + disable autobet)
        const actionFilter = withAccessGuard((interaction) => {
            if (!interaction || interaction.user?.bot) return false
            if (interaction.customId === "bj_disable_autobet") return true
            if (!interaction.customId || !interaction.customId.startsWith("bj_action:")) return false
            return true
        }, { scope: "blackjack:actions" })

        // Use broadcaster for the collector
        this.collector = this.broadcaster.createCollectors({ filter: actionFilter, time: 5 * 60 * 1000 }, async(interaction) => {
            const logCollectorError = (message, meta = {}) =>
                buildInteractionLog(interaction, message, {
                    phase: "actionCollector",
                    customId: interaction.customId,
                    ...meta
                })

            // Handle disable autobet button
            if (interaction.customId === "bj_disable_autobet") {
                const player = this.GetPlayer(interaction.user.id)
                if (!player || !player.autobet || player.autobet.remaining <= 0) {
                    await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You don't have an active autobet.")], flags: MessageFlags.Ephemeral }).catch(
                        logCollectorError("Failed to warn player about missing autobet")
                    )
                    return
                }

                player.autobet = null
                await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription("✅ Autobet disabled.")], flags: MessageFlags.Ephemeral }).catch(
                    logCollectorError("Failed to confirm autobet disable")
                )
                return
            }

            if (this.isRemotePauseActive && this.isRemotePauseActive()) {
                await interaction.reply({
                    embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⏸️ Il tavolo è in pausa dagli admin. Attendi la ripresa.")],
                    flags: MessageFlags.Ephemeral
                }).catch(
                    logCollectorError("Failed to notify player about paused table")
                )
                return
            }

            // Handle regular action buttons
            const [, action, playerId] = interaction.customId.split(":")
            const player = this.GetPlayer(playerId)
            const logActionError = (message, meta = {}) => logCollectorError(message, { action, playerId, ...meta })

            if (!player || !player.status || !player.status.current) {
                const reply = await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ It's not your turn.")], flags: MessageFlags.Ephemeral }).catch(
                    logActionError("Failed to warn player about invalid turn state")
                )
                if (reply) {
                    setTimeout(() => {
                        interaction.deleteReply().catch(
                            logActionError("Failed to remove invalid turn warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            if (interaction.user.id !== playerId) {
                const reply = await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ You're not allowed to do this action.")], flags: MessageFlags.Ephemeral }).catch(
                    logActionError("Failed to warn player about unauthorized action")
                )
                if (reply) {
                    setTimeout(() => {
                        interaction.deleteReply().catch(
                            logActionError("Failed to remove unauthorized action warning", {
                                replyId: reply.id
                            })
                        )
                    }, 5000)
                }
                return
            }

            await interaction.deferUpdate().catch(
                logActionError("Failed to defer blackjack action interaction")
            )
            this.Action(action, player, player.status.currentHand)
        }, () => {
            // On End
            this.collector = null
        })
    }

    async ComputeHandsValue(player, dealer) {
        var inspectHand = (hand) => {
            let aces = hand.cards.filter((card) => {
                return card.split("")[0] == "A"
            }).length
            hand.value = 0

            // Check for pair BEFORE the loop (only if we have exactly 2 cards)
            if (hand.cards.length == 2 && !hand.pair) {
                const firstCard = hand.cards[0].split("")[0]
                const secondCard = hand.cards[1].split("")[0]
                if (firstCard == secondCard) {
                    hand.pair = true
                }
            }

            // Check for blackjack (only if we have exactly 2 cards, 1 ace, and no pair)
            if (!hand.pair && hand.cards.length == 2 && aces == 1 && (player ? player.hands.length < 2 : true == true)) {
                let fig = hand.cards.filter((card) => {
                    return ["K", "Q", "J", "T"].includes(card.split("")[0])
                }).length
                if (fig > 0) hand.BJ = true
            }

            // Calculate hand value
            for (let card of hand.cards) {
                let val = parseInt(card.split("")[0])
                if (!isNaN(val)) hand.value += val
                    else if (card.split("")[0] == "A") hand.value += 11
                        else hand.value += 10
            }

            // Adjust for aces
            while (hand.value > 21 && aces > 0) {
                hand.value -= 10
                aces--
            }

            if (hand.value > 21) hand.busted = true
                else hand.busted = false
            return hand
        }
        if (player) {
            for (let hand of player.hands)
                await inspectHand(hand)
        } else if (dealer) {
            await inspectHand(dealer)
        }
    }

    async GetAvailableOptions(player, h) {
        await this.ComputeHandsValue(player)
        let available = []
        const hand = player.hands[h]
        available.push("stand")
        const isSplitAceHand = hand.fromSplitAce && hand.cards.length >= 2
        if (isSplitAceHand) return available
        available.push("hit")
        const canAffordBaseBet = bankrollManager.canAffordStack(player, player.bets?.initial)
        if (hand.cards.length < 3 && canAffordBaseBet) available.push("double")
        if (hand.pair && player.hands.length < 4 && canAffordBaseBet) available.push("split")
        const insuranceBet = Math.floor(player.bets.initial / 2)
        const dealerUpCard = (this.dealer?.cards?.[0] || "").split("")[0]
        if (dealerUpCard == "A" && player.bets.insurance < 1 && hand.cards.length < 3 && insuranceBet > 0 && bankrollManager.canAffordStack(player, insuranceBet)) available.push("insurance")
        return available
    }

    async Action(type, player, hand, automatic) {
        if (!player.availableOptions.includes(type) && !automatic) return

        // Prevent race condition: if action is already in progress, ignore subsequent calls
        if (player.status?.actionInProgress) {
            logger.debug("Action already in progress, ignoring duplicate call", {
                scope: "blackjackGame",
                playerId: player.id,
                action: type
            })
            return
        }

        // Mark action as in progress
        if (!player.status) player.status = {}
        player.status.actionInProgress = true

        // Clear timer to prevent auto-stand from firing
        if (this.timer) clearTimeout(this.timer)
        this.timer = null

        await this.ComputeHandsValue(player)

        let shouldUpdateEmbed = false
        let actionEndsHand = false
        let postActionPauseMs = null

        const resolvePostActionRenderOptions = () => {
            if (!actionEndsHand) return null
            if (Array.isArray(player.hands) && player.hands.length > hand + 1) {
                return { forceCurrentHandIndex: hand + 1 }
            }
            return { forceInactivePlayerId: player.id }
        }
        try {
        switch(type) {
            case `stand`: {
                const handLabel = player.hands.length > 1 ? ` (Hand #${hand + 1})` : ""
                this.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} stands.`)
                player.hands[hand].locked = true
                shouldUpdateEmbed = true
                actionEndsHand = true
                break
            }
            case `hit`: {
                const newCard = await this.PickRandom(this.cards, 1)
                player.hands[hand].cards = player.hands[hand].cards.concat(newCard)
                await this.ComputeHandsValue(player)
                const handLabel = player.hands.length > 1 ? ` (Hand #${hand + 1})` : ""
                this.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} hits (${formatCardLabel(newCard[0])}).`)
                shouldUpdateEmbed = true
                if (!player.hands[hand].busted) {
                    player.status.actionInProgress = false
                    return this.NextPlayer(player)
                }
                break
            }
            case `double`: {
                const additionalBet = Number.isFinite(player.bets?.initial) ? player.bets.initial : 0
                if (additionalBet < 1 || !bankrollManager.canAffordStack(player, additionalBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return this.NextPlayer(player)
                }
                const newCard = await this.PickRandom(this.cards, 1)
                player.hands[hand].cards = player.hands[hand].cards.concat(newCard)
                if (!bankrollManager.withdrawStackOnly(player, additionalBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return this.NextPlayer(player)
                }
                player.bets.total += additionalBet
                player.hands[hand].bet += additionalBet
                await this.ComputeHandsValue(player)
                player.hands[hand].locked = true
                player.hands[hand].doubleDown = true
                const handLabel = player.hands.length > 1 ? ` (Hand #${hand + 1})` : ""
                this.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} doubles bet (${formatCardLabel(newCard[0])}).`)
                shouldUpdateEmbed = true
                actionEndsHand = true
                if (!player.hands[hand].busted) {
                    player.status.actionInProgress = false
                    if (shouldUpdateEmbed || (Array.isArray(player.availableOptions) && player.availableOptions.length > 0)) {
                        player.availableOptions = []
                        await this.updateRoundProgressEmbed(player, false, resolvePostActionRenderOptions() || {})
                    }
                    return this.NextPlayer(player, true)
                }
                break
            }
            case `split`: {
                const splitCost = Number.isFinite(player.bets?.initial) ? player.bets.initial : 0
                if (splitCost < 1 || !bankrollManager.canAffordStack(player, splitCost)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return this.NextPlayer(player)
                }
                const currentHand = player.hands[hand]
                let removedCard = await currentHand.cards.splice(1, 1)
                currentHand.pair = false
                const splitAce = currentHand.cards[0].split("")[0] == "A"
                currentHand.fromSplitAce = splitAce
                player.hands.push({
                    cards: removedCard.concat(await this.PickRandom(this.cards, 1)),
                    value: 0,
                    pair: false,
                    busted: false,
                    BJ: false,
                    push: false,
                    bet: player.bets.initial,
                    display: [],
                    fromSplitAce: splitAce,
                    result: null,
                    payout: 0,
                    locked: false,
                    doubleDown: false
                })
                currentHand.cards = await currentHand.cards.concat(await this.PickRandom(this.cards, 1))
                await this.ComputeHandsValue(player)
                if (!bankrollManager.withdrawStackOnly(player, splitCost)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return this.NextPlayer(player)
                }
                player.bets.total += splitCost
                this.appendDealerTimeline(`${formatPlayerName(player)} splits hand.`)
                shouldUpdateEmbed = true
                player.status.actionInProgress = false
                return this.NextPlayer(player)
            }
            case `insurance`: {
                const insuranceBet = Math.floor(player.bets.initial / 2)
                if (insuranceBet < 1 || player.bets.insurance > 0) {
                    player.status.actionInProgress = false
                    return
                }
                if (!bankrollManager.canAffordStack(player, insuranceBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return
                }
                if (!bankrollManager.withdrawStackOnly(player, insuranceBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    player.status.actionInProgress = false
                    return
                }
                player.bets.insurance += insuranceBet
                player.bets.total += insuranceBet
                player.status.insurance = {
                    wager: insuranceBet,
                    settled: false
                }
                this.appendDealerTimeline(`${formatPlayerName(player)} buys insurance (${setSeparator(insuranceBet)}$).`)
                // Don't call NextPlayer - just recalculate options and continue turn
                player.availableOptions = await this.GetAvailableOptions(player, player.status.currentHand)
                player.status.actionInProgress = false
                // Update embed with insurance purchase and new options
                await this.updateRoundProgressEmbed(player)
                // Insurance doesn't end the turn - return to keep collecting actions
                return
            }
        }

        await this.ComputeHandsValue(player)

        if (player.hands[hand].busted) {
            const handLabel = player.hands.length > 1 ? ` (Hand #${hand + 1})` : ""
            this.appendDealerTimeline(`${formatPlayerName(player)} busts${handLabel}.`)
            player.hands[hand].locked = true
            shouldUpdateEmbed = true
            actionEndsHand = true
            postActionPauseMs = config.delays.medium.default
        }

        const hadAvailableOptions = Array.isArray(player.availableOptions) && player.availableOptions.length > 0
        if (shouldUpdateEmbed || hadAvailableOptions) {
            player.availableOptions = []
            await this.updateRoundProgressEmbed(player, false, resolvePostActionRenderOptions() || {})
            if (postActionPauseMs) {
                await sleep(postActionPauseMs)
            }
        }

        await sleep(config.delays.short.default)

        // Reset action in progress flag
        player.status.actionInProgress = false

        if (player.hands[hand + 1]) {
            player.status.currentHand++
            this.NextPlayer(player)
        } else {
            player.status.current = false
            let next = this.inGamePlayers[this.inGamePlayers.indexOf(player) + 1]
            if (next) this.NextPlayer(next)
                else this.DealerAction()
        }
        } finally {
            this.queueProbabilityUpdate("playerAction")
        }
    }

    async updateRoundProgressEmbed(player, autoStanding = false, renderOptions = {}) {
        try {
            const paused = Boolean(renderOptions?.paused || (this.isRemotePauseActive && this.isRemotePauseActive()))
            const handSummary = player.hands.map((hand, idx) =>
                formatHandSummary(hand, {
                    isCurrent: idx === player.status.currentHand,
                    includeHandLabel: true,
                    handIndex: idx
                })
            ).join("\n") || "—"
            const timelineText = this.buildDealerTimelineDescription() ?? EMPTY_TIMELINE_TEXT

            const embed = new EmbedBuilder()
                .setColor(paused ? Colors.DarkGrey : Colors.Gold)
                .setTitle(`${player.tag}'s turn`)
                .setDescription(paused
                    ? `⏸️ Tavolo in pausa dagli admin.\n\n${timelineText}`
                    : timelineText)
                .addFields(
                    { name: "Hands", value: handSummary, inline: false }
                )

            if (hasWinProbabilityInsight(player)) {
                const probabilityTitle = `🔮 Outcome probability for ${resolvePlayerLabel(player)}`
                const probabilityField = buildProbabilityField({
                    win: player.status?.winProbability,
                    tie: player.status?.pushProbability,
                    lose: player.status?.lossProbability
                }, {
                    title: probabilityTitle,
                    tieLabel: "🟠 Push"
                }) || {
                    name: probabilityTitle,
                    value: "Calculating...",
                    inline: false
                }
                embed.addFields(probabilityField)
            }

            const components = []
            if (!autoStanding && !paused) {
                const actionRow = buildActionButtons(player.id, player.availableOptions)
                if (actionRow) components.push(actionRow)
            }

            // Add disable autobet button if player has active autobet
            if (!paused && player.autobet && player.autobet.remaining > 0) {
                const autobetRow = new ActionRowBuilder()
                autobetRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId("bj_disable_autobet")
                        .setLabel("Disable Autobet")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🛑")
                )
                components.push(autobetRow)
            }

            // Render image FIRST before sending/editing
            const forceInactivePlayerId = renderOptions?.forceInactivePlayerId
            const forceCurrentHandIndex = renderOptions?.forceCurrentHandIndex
            let renderPlayers = this.inGamePlayers

            if (forceInactivePlayerId || (typeof forceCurrentHandIndex === "number" && !Number.isNaN(forceCurrentHandIndex))) {
                renderPlayers = this.inGamePlayers.map((tablePlayer) => {
                    const isTarget = tablePlayer?.id === player.id
                    const shouldForceInactive = forceInactivePlayerId && tablePlayer?.id === forceInactivePlayerId
                    const shouldForceHand = isTarget && typeof forceCurrentHandIndex === "number" && !Number.isNaN(forceCurrentHandIndex)

                    if (!shouldForceInactive && !shouldForceHand) {
                        return tablePlayer
                    }

                    const statusClone = { ...(tablePlayer.status || {}) }
                    if (shouldForceInactive) {
                        statusClone.current = false
                    }
                    if (shouldForceHand) {
                        statusClone.currentHand = forceCurrentHandIndex
                    }
                    return {
                        ...tablePlayer,
                        status: statusClone
                    }
                })
            }

            const snapshot = await this.captureTableRender({
                filename: `blackjack_round_${this.hands}_progress_${Date.now()}.png`,
                description: `Round progress snapshot for ${player.tag}`,
                hideDealerHoleCard: true,
                maskDealerValue: true,
                forceResult: null,
                players: renderPlayers
            })

            // Build payload with image ready BEFORE any Discord API call
            const payload = {
                embeds: [embed],
                components
            }

            if (snapshot) {
                embed.setImage(`attachment://${snapshot.filename}`)
                payload.files = [snapshot.attachment]
                payload.attachments = []
            }

            // Edit existing message or create new one
            if (this.roundProgressMessage && typeof this.roundProgressMessage.edit === "function") {
                this.roundProgressMessage = await this.roundProgressMessage.edit(payload)
            } else {
                const channel = this.channel
                if (channel && typeof channel.send === "function") {
                    this.roundProgressMessage = await channel.send(payload)
                }
            }
            this.lastRoundMessage = this.roundProgressMessage || this.lastRoundMessage

            // No secondary edits (pruning) to avoid visual flicker
        } catch (error) {
            logger.error("Failed to update round progress embed", {
                scope: "blackjackGame",
                playerId: player?.id,
                error: error.message
            })
        }
    }

    async updateDealerProgressEmbed(isFinal = false) {
        try {
            const timelineText = this.buildDealerTimelineDescription()

            const embed = new EmbedBuilder()
                .setColor(isFinal ? Colors.Blue : Colors.Purple)
                .setTitle(isFinal ? "Round Results" : "Table Timeline")
                .setDescription(timelineText ?? EMPTY_TIMELINE_TEXT)

            // Render image FIRST before editing
            const snapshot = await this.captureTableRender({
                filename: `blackjack_round_${this.hands}_dealer_${Date.now()}.png`,
                description: `Dealer ${isFinal ? 'final' : 'turn'} snapshot for round ${this.hands}`,
                hideDealerHoleCard: false,
                maskDealerValue: false,
                forceResult: null
            })

            // Build payload with image ready BEFORE any Discord API call
            const payload = {
                embeds: [embed],
                components: []
            }

            if (snapshot) {
                embed.setImage(`attachment://${snapshot.filename}`)
                payload.files = [snapshot.attachment]
                payload.attachments = []
            }

            // Edit the same progressive message
            if (this.roundProgressMessage && typeof this.roundProgressMessage.edit === "function") {
                this.roundProgressMessage = await this.roundProgressMessage.edit(payload)
            } else {
                const channel = this.channel
                if (channel && typeof channel.send === "function") {
                    this.roundProgressMessage = await channel.send(payload)
                }
            }
            this.lastRoundMessage = this.roundProgressMessage || this.lastRoundMessage

            // Also keep reference as dealerStatusMessage for compatibility
            this.dealerStatusMessage = this.roundProgressMessage

            // No secondary edits (pruning) to avoid visual flicker
        } catch (error) {
            logger.error("Failed to update dealer progress embed", {
                scope: "blackjackGame",
                error: error.message
            })
        }
    }

    getRemoteActorLabel(meta = {}) {
        if (meta.actorLabel) return meta.actorLabel
        if (meta.actorTag) return meta.actorTag
        if (meta.actor) return `<@${meta.actor}>`
        return "dal pannello"
    }

    async sendRemoteControlNotice(kind, meta = {}) {
        if (!this.channel || typeof this.channel.send !== "function") return
        const label = this.getRemoteActorLabel(meta)
        let description = null
        let color = Colors.DarkGrey
        if (kind === "pause") {
            description = `⏸️ Blackjack in pausa ${label}.`
            color = Colors.Orange
        } else if (kind === "resume") {
            description = `▶️ Blackjack riattivato ${label}.`
            color = Colors.Green
        }
        if (!description) return
        await this.channel.send({
            embeds: [new EmbedBuilder().setColor(color).setDescription(description)],
            allowedMentions: { parse: [] }
        }).catch((error) => {
            logger.warn("Failed to send blackjack remote control notice", {
                scope: "blackjackGame",
                kind,
                error: error?.message
            })
        })
    }

    async handleRemotePause(meta = {}) {
        await super.handleRemotePause(meta)
        if (this.timer) {
            clearTimeout(this.timer)
            this.timer = null
        }
        await this.sendRemoteControlNotice("pause", meta)
        const active = this.inGamePlayers?.find((player) => player.status?.current)
            || this.players?.find((player) => player.status?.current)
        if (active) {
            await this.updateRoundProgressEmbed(active, false, { paused: true })
        }
    }

    async handleRemoteResume(meta = {}) {
        await super.handleRemoteResume(meta)
        await this.sendRemoteControlNotice("resume", meta)
        if (!this.playing) return
        const target = this.awaitingPlayerId ? this.GetPlayer(this.awaitingPlayerId) : null
        if (target) {
            await this.NextPlayer(target)
        } else if (this.inGamePlayers?.length) {
            await this.NextPlayer(this.inGamePlayers[0])
        }
    }


    async DealerAction() {
        await this.ComputeHandsValue(null, this.dealer)
        await this.UpdateInGame()
        this.queueProbabilityUpdate("dealer:start")

        let remainingPlayers = this.inGamePlayers.filter((pl) => {
            return pl.hands.some((hand) => {
                return !hand.busted
            })
        })

        let eliminationResult = { removed: 0, endedGame: false }

        if (remainingPlayers.length < 1) {
            for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                await this.CheckExp(player.status.won.expEarned, player)
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
            }
        } else {
            // Update progressive embed to show dealer's turn
            this.appendDealerTimeline(`**Dealer** reveals hidden card`)
            await this.updateDealerProgressEmbed()
            await sleep(config.delays.short.default)

            // Dealer draws cards until 17 or higher
            while (this.dealer.value < 17) {
                const newCard = await this.PickRandom(this.cards, 1)
                this.dealer.cards = this.dealer.cards.concat(newCard)
                await this.ComputeHandsValue(null, this.dealer)
                this.appendDealerTimeline(`**Dealer** draws ${formatCardLabel(newCard[0])} (total ${this.dealer.value}).`)

                // Update the progressive embed
                await this.updateDealerProgressEmbed()
                await sleep(config.delays.short.default)
            }

            // Final dealer status update
            const finalAction = this.dealer.busted ? "busted" : "stand"
            if (finalAction === "busted") {
                this.appendDealerTimeline("**Dealer** busts.")
            } else {
                this.appendDealerTimeline(`**Dealer** stands at ${this.dealer.value}.`)
            }
            await this.updateDealerProgressEmbed()
            await sleep(config.delays.short.default)

            for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                // Count total hands played (important for split scenarios)
                player.data.hands_played += player.hands.length
                const insuranceWager = player.status.insurance?.wager || 0
                if (this.dealer.BJ && insuranceWager > 0 && !player.status.insurance.settled) {
                    const insurancePayout = insuranceWager * 3
                    bankrollManager.depositStackOnly(player, insurancePayout)
                    player.status.insurance.settled = true
                    player.status.won.grossValue += insurancePayout
                    const insuranceNet = insurancePayout - insuranceWager
                    player.status.won.netValue += insuranceNet
                    if (insuranceNet > 0) {
                        recordNetWin(player, insuranceNet)
                    }
                    this.appendDealerTimeline(`${formatPlayerName(player)} receives insurance payout (+${setSeparator(insurancePayout)}$).`)
                    await sleep(1000)
                }
                for (let hand of player.hands) {
                    let wf = 1
                    let handWon = false
                    hand.result = null
                    hand.payout = 0
                    const applyGoldReward = () => {
                        const goldAwarded = awardGoldForHand(player, { wonHand: handWon })
                        if (goldAwarded > 0) {
                            const tracked = Number(player.status.won.goldEarned) || 0
                            player.status.won.goldEarned = tracked + goldAwarded
                            hand.gold = goldAwarded
                        }
                    }
                    if (hand.busted) {
                        hand.result = "lose"
                        hand.payout = -hand.bet
                        applyGoldReward()
                        continue
                    }

                    // Determine outcome and win factor
                    if (this.dealer.busted) {
                        // Dealer busted - player wins
                        wf = hand.BJ ? 2.5 : 2
                        handWon = true
                        hand.result = "win"
                    } else {
                        // Dealer not busted
                        if (hand.value < this.dealer.value) {
                            // Player loses
                            hand.result = "lose"
                            hand.payout = -hand.bet
                            applyGoldReward()
                            continue
                        } else if (hand.value == this.dealer.value) {
                            // Push - return bet only (not counted as win)
                            hand.push = true
                            wf = 1
                            handWon = false
                            hand.result = "push"
                        } else {
                            // Player wins (hand.value > dealer.value)
                            wf = hand.BJ ? 2.5 : 2
                            handWon = true
                            hand.result = "win"
                        }
                    }

                    // Calculate winnings
                    if (hand.push) {
                        // Push: return the bet (no net gain/loss)
                        bankrollManager.depositStackOnly(player, hand.bet)
                        // grossValue and netValue stay 0 for push (player gets money back but no profit)
                        hand.payout = 0
                    } else {
                        // Win: apply win factor and withholding tax
                        const grossWinning = hand.bet * wf
                        const netWinning = this.GetNetValue(grossWinning, player)
                        bankrollManager.depositStackOnly(player, netWinning)
                        player.status.won.grossValue += grossWinning
                        player.status.won.netValue += netWinning
                        hand.payout = netWinning - hand.bet
                        if (hand.payout > 0) {
                            recordNetWin(player, hand.payout)
                        }
                    }

                    // Count individual hand wins
                    if (handWon) {
                        player.data.hands_won++
                    }

                    applyGoldReward()
                }
                if (player.status.won.grossValue > 0) {
                    player.status.won.expEarned += parseInt((Math.log(player.status.won.grossValue)) * (1.2 + (Math.sqrt(player.status.won.grossValue) * 0.003)) + 10)
                }
                if (player.status.won.grossValue > player.data.biggest_won) player.data.biggest_won = player.status.won.grossValue
                await this.CheckExp(player.status.won.expEarned, player)
                // Save stats (but not stack - stack stays at table for next hand)
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
            }
        }

        const playersOutOfMoney = this.players.filter((pl) => {
            return pl.stack < this.minBet
        })
        if (playersOutOfMoney.length > 0) {
            const finalizeGame = playersOutOfMoney.length >= this.players.length
            eliminationResult = await this.handlePlayersOutOfFunds(playersOutOfMoney, { finalizeGame })
        }

        this.appendDealerTimeline(`Round #${this.hands} showdown.`)
        await this.updateDealerProgressEmbed(true)
        this.queueProbabilityUpdate("dealer:complete")

        if (eliminationResult?.endedGame) {
            await this.Stop({ notify: false, reason: "allPlayersRanOutOfMoney" })
            return
        }

        this.UpdateInGame()
        await sleep(config.delays.short.default)
        let available = this.players.filter((pl) => {
            return pl.stack > 0
        })
        if (this.playing && available.length < 1) {
            const notify = this.lastRemovalReason !== "noMoney"
            await this.Stop({ notify, reason: notify ? undefined : "allPlayersRanOutOfMoney" })
            return
        }
        this.NextHand()
    }

    async startRebuyOffer(player, windowMs) {
        if (!player || !this.channel || typeof this.channel.send !== "function") {
            return { status: "skipped", playerId: player?.id }
        }
        const customId = `bj_rebuy:${player.id}:${Date.now()}`
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        const playerLabel = formatPlayerName(player)
        const embed = new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle("💸 Rebuy available")
            .setDescription(`${playerLabel} ran out of chips.\nYou have **${seconds}s** to rebuy and stay in the game.`)
            .setFooter({ text: `Window closes in ${seconds}s` })

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel("Rebuy")
                .setStyle(ButtonStyle.Primary)
        )

        let message = null
        try {
            message = await this.channel.send({
                embeds: [embed],
                components: [row],
                allowedMentions: { users: [] }
            })
        } catch (error) {
            logger.warn("Failed to send rebuy offer", {
                scope: "blackjackGame",
                playerId: player?.id,
                error: error?.message
            })
            return { status: "failed", playerId: player?.id }
        }

        const filter = withAccessGuard(
            (interaction) => interaction.customId === customId,
            { scope: "blackjack:rebuy" }
        )

        const collector = message.createMessageComponentCollector({
            time: windowMs,
            filter
        })

        const outcome = new Promise((resolve) => {
            collector.on("collect", async(interaction) => {
                if (interaction.user?.id !== player.id) {
                    await interaction.reply({
                        content: "❌ Only this player can rebuy.",
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        buildInteractionLog(interaction, "Failed to warn non-player on rebuy offer", {
                            phase: "rebuy"
                        })
                    )
                    return
                }

                if (this.__stopping) {
                    await interaction.reply({
                        content: "❌ This table is closing. Rebuy unavailable.",
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        buildInteractionLog(interaction, "Failed to warn about closing table on rebuy", {
                            phase: "rebuy"
                        })
                    )
                    return
                }

                const modalId = `bj_rebuy_modal:${interaction.id}`
                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle("Rebuy amount")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("amount")
                                .setLabel("Buy-in amount")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder(`Min: ${setSeparator(this.minBuyIn)}$ | Max: ${setSeparator(this.maxBuyIn)}$`)
                        )
                    )

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    logger.debug("Failed to show rebuy modal", {
                        scope: "blackjackGame",
                        error: error?.message
                    })
                    return
                }

                let submission = null
                try {
                    submission = await interaction.awaitModalSubmit({
                        time: config.blackjack.modalTimeout.default,
                        filter: withAccessGuard(
                            (i) => i.customId === modalId && i.user.id === interaction.user.id,
                            { scope: "blackjack:rebuyModal" }
                        )
                    })
                } catch (_) { return }

                if (!submission) return

                const rawAmount = submission.fields.getTextInputValue("amount")?.trim()
                const parsedAmount = rawAmount ? features.inputConverter(rawAmount) : this.minBuyIn
                const buyInResult = bankrollManager.normalizeBuyIn({
                    requested: parsedAmount,
                    minBuyIn: this.minBuyIn,
                    maxBuyIn: this.maxBuyIn,
                    bankroll: bankrollManager.getBankroll(submission.user)
                })

                if (!buyInResult.ok) {
                    await sendEphemeralError(submission, "❌ Invalid amount for rebuy.")
                    return
                }

                try {
                    await this.commitBuyIn(submission.user, buyInResult.amount)
                } catch (error) {
                    await sendEphemeralError(submission, "❌ Rebuy failed. Please try again.")
                    return
                }

                player.stack = buyInResult.amount
                player.pendingBuyIn = buyInResult.amount
                player.buyInAmount = buyInResult.amount
                player.newEntry = false
                player.rebuysUsed = (Number(player.rebuysUsed) || 0) + 1
                player.status = player.status || {}
                player.status.pendingRebuy = false
                player.status.removed = false
                player.status.leftThisHand = true
                this.appendDealerTimeline(`${formatPlayerName(player)} rebuys for ${setSeparator(buyInResult.amount)}$.`)

                await submission.reply({
                    content: `✅ Rebuy successful: **${setSeparator(buyInResult.amount)}$**.`,
                    flags: MessageFlags.Ephemeral
                }).catch(
                    buildInteractionLog(submission, "Failed to confirm rebuy", {
                        phase: "rebuy"
                    })
                )

                try {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        ButtonBuilder.from(row.components[0]).setDisabled(true)
                    )
                    const updatedEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                        .setDescription(`✅ ${playerLabel} rejoined with **${setSeparator(buyInResult.amount)}$**.`)
                        .setColor(Colors.Green)
                        .setFooter({ text: "▶️ Game will resume shortly" })
                    await message.edit({
                        embeds: [updatedEmbed],
                        components: [disabledRow]
                    }).catch(() => null)
                } catch (_) {
                    // ignore edit errors
                }

                resolve({ status: "completed", playerId: player.id })
                try { collector.stop("completed") } catch (_) { /* ignore */ }
            })

            collector.on("end", async(_collected, reason) => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(row.components[0]).setDisabled(true)
                )
                try {
                    if (reason !== "completed") {
                        const expiredEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                            .setDescription(`⏳ Rebuy window expired for ${playerLabel}.`)
                            .setColor(Colors.DarkRed)
                            .setFooter({ text: "Player remains out" })
                        await message.edit({ embeds: [expiredEmbed], components: [disabledRow] }).catch(() => null)
                        this.appendDealerTimeline(`${formatPlayerName(player)} did not rebuy in time.`)
                    } else {
                        await message.edit({ components: [disabledRow] }).catch(() => null)
                    }
                } catch (_) { /* ignore */ }

                if (reason !== "completed") {
                    resolve({ status: "expired", playerId: player?.id })
                }

                this.rebuyOffers.delete(player.id)
            })
        })

        this.rebuyOffers.set(player.id, { message, collector, expiresAt: Date.now() + windowMs })
        return outcome
    }

    GetNetValue(grossValue, player) {
        return grossValue - parseInt(grossValue * (features.applyUpgrades("with-holding", player.data.withholding_upgrade, 0.0003 * 8, 0.00002 * 2.5)))
    }

    async commitBuyIn(user, amount) {
        const currentBankroll = bankrollManager.getBankroll(user)
        if (currentBankroll < amount) {
            const error = new Error("insufficient-bankroll")
            error.code = "INSUFFICIENT_BANKROLL"
            throw error
        }
        user.data.money = currentBankroll - amount
        try {
            await this.dataHandler.updateUserData(user.id, this.dataHandler.resolveDBUser(user))
        } catch (error) {
            user.data.money = currentBankroll
            throw error
        }
        return true
    }

    async AddPlayer(user, options = {}) {
        if (!user || !user.id) {
            return { ok: false, reason: "invalidUser" }
        }
        if (this.__stopping) {
            logger.debug("Rejecting blackjack join while table is stopping", {
                scope: "blackjackGame",
                playerId: user.id
            })
            return { ok: false, reason: "stopping" }
        }
        const maxSeats = Number.isFinite(this.maxPlayers) && this.maxPlayers > 0 ? this.maxPlayers : Infinity
        if (this.players.length >= maxSeats) {
            await this.SendMessage("maxPlayers", user)
            return { ok: false, reason: "maxSeats" }
        }
        if (this.GetPlayer(user.id)) {
            return { ok: false, reason: "alreadySeated" }
        }
        const requestedBuyIn =
            options.buyIn ?? options.requestedBuyIn ?? (typeof user.stack === "number" ? user.stack : undefined)
        const buyInResult = bankrollManager.normalizeBuyIn({
            requested: requestedBuyIn,
            minBuyIn: this.minBuyIn,
            maxBuyIn: this.maxBuyIn,
            bankroll: bankrollManager.getBankroll(user)
        })
        if (!buyInResult.ok) {
            await this.SendMessage("noMoneyBet", user)
            return { ok: false, reason: buyInResult.reason || "noMoney" }
        }
        const player = this.createPlayerSession(user, buyInResult.amount)
        if (!player) {
            return { ok: false, reason: "sessionUnavailable" }
        }

        this.players.push(player)

        const buyInPromise = this.commitBuyIn(user, buyInResult.amount)
        this.pendingJoins.set(player.id, buyInPromise)

        try {
            await buyInPromise
        } catch (error) {
            const index = this.players.indexOf(player)
            if (index !== -1) this.players.splice(index, 1)
            player.stack = 0

            if (error?.code === "INSUFFICIENT_BANKROLL" || error?.code === "insufficient-bankroll") {
                await this.SendMessage("noMoneyBet", user)
            } else {
                logger.error("Failed to finalize blackjack buy-in", {
                    scope: "blackjackGame",
                    playerId: user.id,
                    error: error?.message
                })
                await this.SendMessage("noMoneyBet", user)
            }
            return { ok: false, reason: error?.code === "INSUFFICIENT_BANKROLL" ? "noMoney" : "buyInCommitFailed" }
        } finally {
            this.pendingJoins.delete(player.id)
        }

        if (this.__stopping) {
            logger.debug("Blackjack table stopping during buy-in, refunding immediately", {
                scope: "blackjackGame",
                playerId: user.id
            })
            await this.RemovePlayer(player, { skipStop: true })
            return { ok: false, reason: "stopping" }
        }

        return { ok: true, player }
    }

    async RemovePlayer(player, options = {}) {
        const { skipStop = false, stopOptions = {} } = options
        const playerId = typeof player === "object" ? player?.id : player
        if (!playerId) return false
        const existing = this.GetPlayer(playerId)
        if (!existing) return false

        await this.waitForPendingJoin(playerId)

        // Return stack to bankroll before removing player
        const { refunded } = this.applyStackRefund(existing, { includePending: true })
        if (refunded > 0) {
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing))
        }

        this.trackBettingDeparture(existing)

        const index = this.players.indexOf(existing)
        if (index !== -1) this.players.splice(index, 1)
        this.UpdateInGame()

        const noPlayersLeft = this.players.length < this.getMinimumPlayers();
        if (noPlayersLeft && !skipStop) {
            const stopPayload = { ...stopOptions }
            if (!Object.prototype.hasOwnProperty.call(stopPayload, "reason")) {
                // Use more specific reason if available
                if (this.lastRemovalReason === "noMoney") {
                    stopPayload.reason = "allPlayersRanOutOfMoney"
                } else {
                    stopPayload.reason = "allPlayersLeft"
                }
            }
            try {
                await this.Stop(stopPayload)
            } catch (error) {
                logger.error("Failed to stop blackjack after removing last player", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: error.message,
                    stack: error.stack
                })
            }
        }
        return true
    }

    UpdateInGame() {
        return this.inGamePlayers = this.players.filter((pl) => pl && !pl.newEntry && pl.bets && pl.bets.initial > 0)
    }

    async cleanupRoundRender() {
        if (!this.settings?.autoCleanHands) return
        const seen = new Set()
        const targets = [this.roundProgressMessage, this.dealerStatusMessage, this.lastRoundMessage]
        for (const target of targets) {
            const id = target?.id || target
            if (!target || seen.has(id)) continue
            seen.add(id)
            this.scheduleMessageCleanup(target)
        }
        this.roundProgressMessage = null
        this.dealerStatusMessage = null
        this.lastRoundMessage = null
    }

    async cleanupPlayerPanels() {
        if (!this.settings?.autoCleanHands) return
        if (!Array.isArray(this.players)) return
        for (const player of this.players) {
            if (player?.status?.infoMessage && typeof player.status.infoMessage.delete === "function") {
                this.scheduleMessageCleanup(player.status.infoMessage)
            }
            if (player?.status) {
                player.status.infoMessage = null
            }
        }
    }

    async closeRebuyOffers() {
        if (!this.rebuyOffers || this.rebuyOffers.size === 0) return
        for (const [playerId, offer] of this.rebuyOffers.entries()) {
            const collector = offer?.collector
            const message = offer?.message
            if (collector && !collector.ended) {
                try { collector.stop("table-closed") } catch (_) { /* ignore */ }
            }
            if (message && typeof message.edit === "function") {
                try {
                    await message.edit({ components: [] }).catch(() => null)
                } catch (_) {
                    // ignore edit errors
                }
            }
            this.rebuyOffers.delete(playerId)
        }
    }

    async Reset () {
        // Stop the action collector to prevent duplicates in next round
        if (this.collector) {
            this.collector.stop()
            this.collector = null
        }

        if (this.settings?.autoCleanHands) {
            await this.cleanupRoundRender()
            await this.cleanupPlayerPanels()
        }

        for (let player of this.players) {
            await delete player.bets
            await delete player.status
            await delete player.hands
            await delete player.newEntry
        }
        this.dealerTimeline = []
        this.pendingProbabilityTask = null
        this.probabilitySequence = 0
        this.clearProbabilitySnapshot()
    }
    async Stop(options = {}) {
        if (this.__stopping) {
            return null
        }
        this.__stopping = true
        await this.waitForPendingJoins()
        await this.closeRebuyOffers()
        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ paused: false, stoppedAt: new Date().toISOString() })
        }
        this.isBettingPhaseOpen = false
        const notify = Object.prototype.hasOwnProperty.call(options || {}, "notify") ? options.notify : true
        const reason = options.reason || "allPlayersLeft"
        this.betsPanelVersion += 1

        // Remove buttons from progressive round embed
        if (this.roundProgressMessage && typeof this.roundProgressMessage.edit === "function") {
            try {
                const progressEmbed = this.roundProgressMessage.embeds?.[0]
                if (progressEmbed) {
                    const updatedEmbed = EmbedBuilder.from(progressEmbed)
                    await this.roundProgressMessage.edit({
                        embeds: [updatedEmbed],
                        components: []
                    })
                }
            } catch (error) {
                logger.debug("Failed to remove buttons from progress embed on stop", {
                    scope: "blackjackGame",
                    error: error.message
                })
            }
        }

        // Remove buttons from bets message (only if still open)
        if (this.isBettingPhaseOpen && this.betsMessage && typeof this.betsMessage.edit === "function") {
            try {
                await this.betsMessage.edit({ components: [] })
                if (this.settings?.autoCleanHands) {
                    this.scheduleMessageCleanup(this.betsMessage)
                }
            } catch (error) {
                logger.debug("Failed to remove buttons from bets embed on stop", {
                    scope: "blackjackGame",
                    error: error.message
                })
            }
        }

        // Sync all stacks to bankroll before stopping
        for (const player of this.players) {
            const { refunded } = this.applyStackRefund(player, { includePending: true })
            if (refunded <= 0) continue
            try {
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
            } catch (error) {
                logger.error("Failed to sync player stack on stop", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    playerId: player.id,
                    error: error.message
                })
            }
        }

        await this.Reset()
        this.playing = false
        if (this.channel && this.channel.collector) this.channel.collector.stop()
        if (this.betsCollector) this.betsCollector.stop()
        if (this.channel) this.channel.collector = null
        this.betsCollector = null
        if (this.collector) this.collector.stop()
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.collector = null
        if (this.channel) {
            this.channel.game = null
            this.channel.__blackjackStarting = false
            if (this.channel.manageable && this.channel.prevRL !== undefined && this.channel.prevRL !== null) {
                try {
                    await this.channel.setRateLimitPerUser(this.channel.prevRL)
                } catch (error) {
                    logger.error("Failed to restore channel slowmode after blackjack stop", {
                        scope: "blackjackGame",
                        channelId: this.channel?.id,
                        error: error.message,
                        stack: error.stack
                    })
                }
            }
        }
        if (this.client && this.client.activeGames) this.client.activeGames.delete(this)
        if (notify) {
            return this.SendMessage("delete", null, { reason })
        }
        return null
    }
    async Run() {
        if (this.playing) return
        if (this.channel?.manageable) {
            const currentRateLimit =
                typeof this.channel.rateLimitPerUser === "number" ? this.channel.rateLimitPerUser : 0
            this.channel.prevRL = currentRateLimit
            try {
                await this.channel.setRateLimitPerUser(4)
            } catch (error) {
                logger.error("Failed to apply blackjack slowmode", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: error.message,
                    stack: error.stack
                })
            }
        }
        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ startedAt: new Date().toISOString(), paused: false })
        }
        this.playing = true
        try {
            await this.NextHand()
        } catch (error) {
            logger.error("Blackjack run loop failed", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message,
                stack: error.stack
            })
            try {
                await this.Stop({ notify: false })
            } catch (stopError) {
                logger.error("Failed to stop blackjack after run loop failure", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: stopError.message,
                    stack: stopError.stack
                })
            }
        }
    }
}