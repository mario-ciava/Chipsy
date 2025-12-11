const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, AttachmentBuilder, MessageFlags, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const features = require("../../../shared/features")
const { sleep } = require("../../utils/helpers")
const Game = require("../shared/baseGame.js")
const cards = require("../shared/cards.js")
const setSeparator = require("../../../shared/utils/setSeparator")
const bankrollManager = require("../../utils/bankrollManager")
const { recordNetWin } = bankrollManager
const { awardGoldForHand } = require("../../utils/goldRewardManager")
const { buildProbabilityField } = require("../../utils/probabilityFormatter")
const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
const logger = require("../../../shared/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../../utils/interactionAccess")
const config = require("../../../config")
const BlackjackRenderer = require("./blackjackRenderer")
const { resolveBlackjackSettings, defaults: blackjackSettingDefaults } = require("./settings")
const GameBroadcaster = require("../shared/gameBroadcaster")
const HandEvaluator = require("./handEvaluator")
const DealerEngine = require("./dealerEngine")
const InsuranceManager = require("./insuranceManager")
const SplitManager = require("./splitManager")
const ActionHandler = require("./actionHandler")
const BettingPhase = require("./bettingPhase")
const RebuyManager = require("./rebuyManager")

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

        // Game module initialization
        this.handEvaluator = HandEvaluator // Static class
        this.dealerEngine = new DealerEngine(this)
        this.insuranceManager = new InsuranceManager(this)
        this.splitManager = new SplitManager(this)
        this.actionHandler = new ActionHandler(this)
        this.bettingPhaseManager = new BettingPhase(this)
        this.rebuyManager = new RebuyManager(this)

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
        return this.rebuyManager.isRebuyEnabled()
    }

    getRebuyWindowMs() {
        return this.rebuyManager.getRebuyWindowMs()
    }

    canPlayerRebuy(player) {
        return this.rebuyManager.canPlayerRebuy(player)
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
        return await this.rebuyManager.handlePlayersOutOfFunds(players, options)
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
                if (!this.betsCollector) {
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

                if (remaining < 1) {
                    this.broadcaster.stopCollectors("allBetsPlaced")
                    this.betsCollector = null
                }
            }
        }, async (collected, reason) => {
            // On End - betting phase complete
            this.betsCollector = null
            this.isBettingPhaseOpen = false

            // Determine appropriate close reason
            let closeReason = "timeout"
            if (reason === "allBetsPlaced") {
                closeReason = "allBetsPlaced"
            } else if (reason === "gameStopped" || reason === "cleanup") {
                // Game was stopped externally, don't continue
                return
            }

            try {
                // Close bets message
                await this.CloseBetsMessage(closeReason)

                // Check if any players have placed bets
                const playersWithBets = this.players.filter(p => p.bets && p.bets.initial > 0)

                if (playersWithBets.length === 0) {
                    // No bets placed - stop the game
                    await this.Stop({ reason: "noBetsPlaced", notify: false })
                    return
                }

                // Update inGame players
                await this.UpdateInGame()

                // Deal initial cards to dealer
                this.dealer.cards = await this.PickRandom(this.cards, 2)
                this.dealerEngine.evaluateDealerHand()

                // Evaluate all player hands for blackjack
                for (const player of this.inGamePlayers) {
                    await this.ComputeHandsValue(player)
                }

                // Short delay before starting player turns
                await sleep(config.delays.short.default)

                // Start with the first player
                if (this.inGamePlayers.length > 0) {
                    await this.NextPlayer(this.inGamePlayers[0])
                } else {
                    // No players left, stop the game
                    await this.Stop({ reason: "noPlayers", notify: false })
                }
            } catch (error) {
                logger.error("Error in blackjack betting onEnd callback", {
                    scope: "blackjackGame",
                    error: error.message,
                    stack: error.stack
                })
                // Try to stop the game gracefully
                await this.Stop({ reason: "error", notify: false }).catch(() => null)
            }
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
            // Use broadcaster to update all channels
            await this.broadcaster.broadcast({ embeds: [embed], components })
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
            // Use broadcaster to update all channels
            await this.broadcaster.broadcast({ embeds: [embed], components })
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
        if (player) {
            for (let hand of player.hands) {
                HandEvaluator.evaluateHand(hand, {
                    isPlayerHand: true,
                    playerHandCount: player.hands.length
                })
            }
        } else if (dealer) {
            HandEvaluator.evaluateHand(dealer, { isPlayerHand: false })
        }
    }

    async GetAvailableOptions(player, h) {
        return await this.actionHandler.getAvailableActions(player, h)
    }

    async Action(type, player, hand, automatic) {
        const result = await this.actionHandler.processAction(type, player, hand, automatic)

        if (!result.success) return

        // Handle action result and game flow
        if (result.continueHand) {
            // Hit or split - update embed and continue same player's turn
            if (result.shouldUpdateEmbed) {
                const renderOptions = result.insuranceTaken ? {} : null
                await this.updateRoundProgressEmbed(player, false, renderOptions || {})
            }
            return
        }

        // Action ended hand - move to next hand or next player
        const resolvePostActionRenderOptions = () => {
            if (!result.actionEndsHand) return null
            if (Array.isArray(player.hands) && player.hands.length > hand + 1) {
                return { forceCurrentHandIndex: hand + 1 }
            }
            return { forceInactivePlayerId: player.id }
        }

        const hadAvailableOptions = Array.isArray(player.availableOptions) && player.availableOptions.length > 0
        if (result.shouldUpdateEmbed || hadAvailableOptions) {
            player.availableOptions = []
            await this.updateRoundProgressEmbed(player, false, resolvePostActionRenderOptions() || {})
        }

        await sleep(config.delays.short.default)

        if (player.hands[hand + 1]) {
            player.status.currentHand++
            this.NextPlayer(player)
        } else {
            player.status.current = false
            let next = this.inGamePlayers[this.inGamePlayers.indexOf(player) + 1]
            if (next) this.NextPlayer(next)
                else this.DealerAction()
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
            // Dealer plays hand using dealerEngine
            await this.dealerEngine.playHand(async () => {
                await this.updateDealerProgressEmbed()
            })

            for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                // Count total hands played (important for split scenarios)
                player.data.hands_played += player.hands.length
                // Resolve insurance bets if dealer has blackjack
                const insuranceResult = this.insuranceManager.resolveInsurance(
                    this.dealer.BJ,
                    player,
                    formatPlayerName
                )
                if (insuranceResult.paidOut) {
                    player.status.won.grossValue += insuranceResult.payoutAmount
                    player.status.won.netValue += insuranceResult.netWin
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

                    // Determine outcome using HandEvaluator
                    const comparison = HandEvaluator.compareHands(hand, this.dealer)
                    hand.result = comparison.result
                    wf = comparison.winFactor
                    handWon = comparison.result === "win"
                    if (comparison.result === "push") hand.push = true

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
        return await this.rebuyManager.startRebuyOffer(player, windowMs)
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
        if (this.betsCollector) {
            this.broadcaster.stopCollectors("gameStopped")
            this.betsCollector = null
        }
        if (this.channel) this.channel.collector = null
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