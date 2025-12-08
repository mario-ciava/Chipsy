const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, MessageFlags } = require("discord.js")
const features = require("../shared/features.js")
const { sleep } = require("../../utils/helpers")
const Game = require("../shared/baseGame.js")
const cards = require("../shared/cards.js")
const setSeparator = require("../../utils/setSeparator")
const logger = require("../../utils/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../../utils/interactionAccess")
const bankrollManager = require("../../utils/bankrollManager")
const { recordNetWin } = require("../../utils/netProfitTracker")
const { awardGoldForHand } = require("../../utils/goldRewardManager")
const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
const config = require("../../../config")
const { validateAmount, validateStack, MAX_SAFE_STACK, createPlayerStatus, createPlayerSession: createPlayerSessionSchema } = require("../shared/playerStateSchema")
const BettingEngine = require("./bettingEngine")
const TexasRenderer = require("./texasRenderer")
const HandProgression = require("./handProgression")
const MessageManagement = require("../shared/messageManagement")
const { resolveTexasSettings, defaults: texasSettingDefaults } = require("./settings")

const buildTexasInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "texasGame",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const createWonState = () => ({ grossValue: 0, netValue: 0, expEarned: 0, goldEarned: 0 })

/**
 * toSafeInteger(value): normalize an integer chip amount.
 *
 * Delegates to the shared validator to ensure it is finite, positive, and capped at MAX_SAFE_STACK.
 */
const toSafeInteger = (value) => {
    return validateAmount(value, MAX_SAFE_STACK)
}

module.exports = class TexasGame extends Game {
    constructor(info) {
        super(info)
        this.cards = [...cards]
        this.tableCards = []
        this.bets = {
            minRaise: info.minBet,
            currentMax: 0,
            total: 0,
            pots: []
        }
        this.actionTimeoutMs = config.texas.actionTimeout.default
        this.actionCollector = null
        this.gameMessage = null
        this.awaitingPlayerId = null
        this.actionOrder = []
        this.actionCursor = -1
        this.currentHandHasInteraction = false
        this.inactiveHands = 0
        this.holeCardsSent = false
        this.pendingProbabilityTask = null
        this.actionTimeline = []
        this.lastValidSnapshot = null
        this.settings = resolveTexasSettings({ overrides: info?.settings })
        this.rebuyOffers = new Map()
        this.waitingForRebuy = false
        this.rebuyResumeTimer = null
        this.dealerOffset = -1
        this.lastHandMessage = null
        this.currentSmallBlindId = null
        this.currentBigBlindId = null
        this.currentHandOrder = []

        // Initialize dedicated modules to keep responsibilities separated
        this.betting = new BettingEngine(this)
        this.renderer = new TexasRenderer(this)
        this.progression = new HandProgression(this)
        this.messages = new MessageManagement(this)
    }

    /**
     * createPlayerSession(user, stackAmount): create a new player object.
     *
     * Delegates to the shared factory in playerStateSchema.js for consistent validation.
     */
    createPlayerSession(user, stackAmount) {
        return createPlayerSessionSchema(user, stackAmount)
    }

    applySettings(overrides = {}) {
        this.settings = resolveTexasSettings({ overrides })
    }

    getActionTimeoutLimits() {
        const fallbackMin = 15 * 1000
        const fallbackMax = 120 * 1000
        const allowed = config?.texas?.actionTimeout?.allowedRange || {}
        return {
            min: Number.isFinite(allowed.min) ? allowed.min : fallbackMin,
            max: Number.isFinite(allowed.max) ? allowed.max : fallbackMax
        }
    }

    getRemoteActorLabel(meta = {}) {
        if (meta.actorLabel) return meta.actorLabel
        if (meta.actorTag) return meta.actorTag
        if (meta.actor) return `<@${meta.actor}>`
        return "from control panel"
    }

    async sendRemoteControlNotice(kind, meta = {}) {
        if (!this.channel || typeof this.channel.send !== "function") return
        const label = this.getRemoteActorLabel(meta)
        let description = null
        let color = Colors.DarkGrey
        if (kind === "pause") {
            description = `⏸️ Table paused by ${label}.`
            color = Colors.Orange
        } else if (kind === "resume") {
            description = `▶️ Table resumed by ${label}.`
            color = Colors.Green
        }
        if (!description) return
        await this.channel.send({
            embeds: [new EmbedBuilder().setColor(color).setDescription(description)],
            allowedMentions: { parse: [] }
        }).catch((error) => {
            logger.warn("Failed to send remote control notice", {
                scope: "texasGame",
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
        if (this.awaitingPlayerId) {
            const player = this.GetPlayer(this.awaitingPlayerId)
            if (player) {
                await this.updateGameMessage(player, { remotePaused: true, hideActions: true })
            }
        }
    }

    async handleRemoteResume(meta = {}) {
        await super.handleRemoteResume(meta)
        await this.sendRemoteControlNotice("resume", meta)
        if (!this.playing) return
        const target = this.awaitingPlayerId ? this.GetPlayer(this.awaitingPlayerId) : null
        if (target) {
            await this.NextPlayer(target)
        } else {
            await this.advanceHand()
        }
    }

    updateActionTimeout(durationMs) {
        const { min, max } = this.getActionTimeoutLimits()
        const numeric = Number(durationMs)
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return { ok: false, reason: "Invalid duration." }
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

    rememberPlayerInteraction(playerRef, interaction) {
        if (!interaction || typeof interaction.followUp !== "function") return
        const player = typeof playerRef === "object" ? playerRef : this.GetPlayer(playerRef)
        if (!player) return
        player.lastInteraction = interaction
        if (this.playing && this.hands > 0) {
            this.currentHandHasInteraction = true
        }
    }

    buildProbabilityState() {
        const deck = Array.isArray(this.cards) ? this.cards.filter(Boolean) : []
        const boardCards = Array.isArray(this.tableCards) ? this.tableCards.filter(Boolean) : []
        const players = Array.isArray(this.players)
            ? this.players.map((player) => ({
                id: player?.id,
                cards: Array.isArray(player?.cards) ? player.cards.filter(Boolean) : [],
                folded: Boolean(player?.status?.folded),
                removed: Boolean(player?.status?.removed),
                allIn: Boolean(player?.status?.allIn)
            }))
            : []
        return {
            deck: { remaining: deck },
            boardCards,
            players,
            round: this.hands,
            awaitingPlayerId: this.awaitingPlayerId || null,
            stage: boardCards.length
        }
    }


    appendActionLog(player, type, meta = {}) {
        if (!player) return
        if (!Array.isArray(this.actionTimeline)) this.actionTimeline = []
        const label = player.tag || player.username || player.toString()
        const entry = {
            playerId: player.id,
            label,
            type,
            amount: Number.isFinite(meta.amount) ? Math.max(0, Math.floor(meta.amount)) : null,
            total: Number.isFinite(meta.total) ? Math.max(0, Math.floor(meta.total)) : null,
            isBlind: Boolean(meta.isBlind),
            ts: Date.now()
        }
        this.actionTimeline.push(entry)
        const maxEntries = 40
        if (this.actionTimeline.length > maxEntries) {
            this.actionTimeline = this.actionTimeline.slice(-maxEntries)
        }
    }

    formatActionEntry(entry) {
        if (!entry) return null
        const type = entry.type
        const amount = entry.amount ?? entry.total
        const hasAmount = Number.isFinite(amount) && amount > 0

        // Action label in bold
        let actionLabel
        if (type === "fold") actionLabel = "**Fold**"
        else if (type === "check") actionLabel = "**Check**"
        else if (type === "call") actionLabel = "**Call**"
        else if (type === "bet") actionLabel = entry.isBlind ? "**Blind**" : "**Bet**"
        else if (type === "raise") actionLabel = "**Raise**"
        else if (type === "allin") actionLabel = "**All-in**"
        else actionLabel = `**${String(type).charAt(0).toUpperCase() + String(type).slice(1)}**`

        // Amount in parentheses for money actions
        if (hasAmount && ["call", "bet", "raise", "allin"].includes(type)) {
            return `${actionLabel} (${setSeparator(amount)}$)`
        }
        if (hasAmount && type === "bet" && entry.isBlind) {
            return `${actionLabel} (${setSeparator(amount)}$)`
        }
        return actionLabel
    }

    formatTimelineTime(ts) {
        if (!Number.isFinite(ts)) return ""
        const date = new Date(ts)
        const hh = String(date.getHours()).padStart(2, "0")
        const mm = String(date.getMinutes()).padStart(2, "0")
        const ss = String(date.getSeconds()).padStart(2, "0")
        return `${hh}:${mm}:${ss}`
    }

    buildActionTimeline({ pot, toCall } = {}) {
        // Timeline contains all actions except blinds (those are in the Info field)
        if (!Array.isArray(this.actionTimeline) || this.actionTimeline.length === 0) {
            return "No actions yet."
        }

        const lines = this.actionTimeline
            .filter((entry) => !entry?.isBlind) // Skip blind entries
            .map((entry) => {
                const actionLabel = this.formatActionEntry(entry)
                if (!actionLabel) return null
                const timeLabel = this.formatTimelineTime(entry.ts) || "--:--:--"
                const userMention = entry.playerId ? `<@${entry.playerId}>` : entry.label
                return `\`${timeLabel}\` ${userMention} ${actionLabel}`
            })
            .filter(Boolean)

        if (!lines.length) {
            return "No actions yet."
        }

        return lines.join("\n")
    }

    getBlindAssignments() {
        const resolvePlayer = (id) => {
            if (!id) return null
            const player = this.GetPlayer(id)
            if (!player) return null
            if (player.status?.removed) return null
            return player
        }

        let sbPlayer = resolvePlayer(this.currentSmallBlindId)
        let bbPlayer = resolvePlayer(this.currentBigBlindId)

        // Fallback to current hand order (or in-game order) if IDs are missing/invalid
        const orderedIds = Array.isArray(this.currentHandOrder) && this.currentHandOrder.length
            ? this.currentHandOrder
            : (this.inGamePlayers || []).map((p) => p.id)

        if (!sbPlayer && orderedIds.length) {
            sbPlayer = resolvePlayer(orderedIds[0]) || null
        }
        if (!bbPlayer && orderedIds.length > 1) {
            const bbId = orderedIds.find((id) => id && id !== sbPlayer?.id)
            bbPlayer = resolvePlayer(bbId) || null
        }

        return { sbPlayer, bbPlayer }
    }

    buildInfoAndTimelineFields({ toCall = 0, pot } = {}) {
        const tableMinBet = this.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        const bigBlind = tableMinBet

        const { sbPlayer, bbPlayer } = this.getBlindAssignments()
        const sbInfo = sbPlayer ? `<@${sbPlayer.id}> (${setSeparator(smallBlind)}$)` : `(${setSeparator(smallBlind)}$)`
        const bbInfo = bbPlayer ? `<@${bbPlayer.id}> (${setSeparator(bigBlind)}$)` : `(${setSeparator(bigBlind)}$)`

        const timeline = this.buildActionTimeline({
            pot: pot ?? this.getDisplayedPotValue(),
            toCall
        })

        return [
            {
                name: "📜 Timeline",
                value: timeline,
                inline: true
            },
            {
                name: "ℹ️ Info",
                value: `SB: ${sbInfo}\nBB: ${bbInfo}`,
                inline: true
            }
        ]
    }

    applyProbabilitySnapshot(result, meta = {}) {
        if (!result?.payload?.players) return null
        const playerStats = result.payload.players
        for (const player of this.players) {
            if (!player) continue
            if (!player.status) player.status = {}
            const stats = playerStats[player.id]
            if (stats && stats.eligible && hasWinProbabilityInsight(player)) {
                player.status.winProbability = stats.win ?? 0
                player.status.tieProbability = stats.tie ?? 0
            } else {
                delete player.status.winProbability
                delete player.status.tieProbability
            }
        }
        return this.setProbabilitySnapshot("texas", {
            ...result.payload,
            updatedAt: result.updatedAt,
            durationMs: result.durationMs,
            reason: meta?.reason || result.reason || null
        })
    }

    resetPlayerProbabilityState() {
        if (!Array.isArray(this.players)) return
        for (const player of this.players) {
            if (!player?.status) continue
            delete player.status.winProbability
            delete player.status.tieProbability
            delete player.status.probabilitySamples
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
        if (!engine || typeof engine.calculateTexas !== "function") return
        const state = this.buildProbabilityState()
        const sequence = ++this.probabilitySequence
        this.pendingProbabilityTask = engine
            .calculateTexas(state, { reason })
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
                logger.warn("Texas probability calculation failed", {
                    scope: "texasGame",
                    reason,
                    error: error?.message
                })
            })
    }

    /**
     * buildPlayerRenderPayload(player, options): create the payload for rendering a player.
     *
     * Delegates to the renderer.
     */
    buildPlayerRenderPayload(player, options = {}) {
        return this.renderer.buildPlayerRenderPayload(player, options)
    }

    /**
     * createPlayerPanelAttachment(player, options): create a PNG panel for a player.
     *
     * Delegates to the renderer.
     */
    async createPlayerPanelAttachment(player, options = {}) {
        return this.renderer.createPlayerPanelAttachment(player, options)
    }

    async evaluateHandInactivity() {
        if (!this.playing) {
            this.currentHandHasInteraction = false
            this.inactiveHands = 0
            return false
        }
        if (this.currentHandHasInteraction) {
            this.inactiveHands = 0
        } else {
            this.inactiveHands += 1
        }
        this.currentHandHasInteraction = false

        if (this.inactiveHands >= 2) {
            await this.updateInactivityEmbed()
            await this.Stop({ reason: "inactivity" })
            return true
        }
        return false
    }

    async AddPlayer(user, options = {}) {
        if (!user || !user.id) return false
        const maxSeats = Number.isFinite(this.maxPlayers) && this.maxPlayers > 0 ? this.maxPlayers : Infinity
        if (this.players.length >= maxSeats) return false
        if (this.GetPlayer(user.id)) return false

        const requestedBuyIn =
            options.buyIn ?? options.requestedBuyIn ?? (typeof user.stack === "number" ? user.stack : undefined)
        const buyInResult = bankrollManager.normalizeBuyIn({
            requested: requestedBuyIn,
            minBuyIn: this.minBuyIn,
            maxBuyIn: this.maxBuyIn,
            bankroll: bankrollManager.getBankroll(user)
        })
        if (!buyInResult.ok) return false

        const player = this.createPlayerSession(user, buyInResult.amount)
        if (!player) return false

        const currentBankroll = bankrollManager.getBankroll(user)
        if (currentBankroll < buyInResult.amount) return false

        user.data.money = currentBankroll - buyInResult.amount

        await this.dataHandler.updateUserData(user.id, this.dataHandler.resolveDBUser(user))

        // Final check before push to prevent race condition duplicates
        if (this.GetPlayer(user.id)) {
            // Player was added by a concurrent call, refund the buy-in
            user.data.money = currentBankroll
            await this.dataHandler.updateUserData(user.id, this.dataHandler.resolveDBUser(user))
            return false
        }

        this.players.push(player)
        return true
    }

    async sendPlayerLeftNotice(player, reason = "left") {
        if (!player || !this.channel || typeof this.channel.send !== "function") return
        try {
            const playerLabel = player.tag || player.username || player.toString()
            const message = reason === "busted"
                ? `💸 ${playerLabel} ran out of chips and left the table.`
                : `🏃 ${playerLabel} left the table.`
            const color = reason === "busted" ? Colors.Red : Colors.Orange
            const embed = new EmbedBuilder()
                .setColor(color)
                .setDescription(message)
            await this.channel.send({
                embeds: [embed],
                allowedMentions: { parse: [] }
            }).catch((error) => {
                logger.warn("Failed to send Texas player left notice", {
                    scope: "texasGame",
                    playerId: player?.id,
                    reason,
                    error: error?.message
                })
            })
        } catch (error) {
            logger.warn("Error sending Texas player left notice", {
                scope: "texasGame",
                error: error?.message
            })
        }
    }

    isRebuyEnabled() {
        return this.settings?.allowRebuyMode !== "off"
    }

    getRebuyWindowMs() {
        const fallback = texasSettingDefaults.rebuyWindowMs || 60 * 1000
        const min = texasSettingDefaults.minWindowMs || 30 * 1000
        const max = texasSettingDefaults.maxWindowMs || 10 * 60 * 1000
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

    buildRebuyPauseFooter(windowMs) {
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        return `⏸️ Waiting for rebuy: the table will remain paused for up to ${seconds}s.`
    }

    async applyRebuyPauseFooter(windowMs) {
        const footerText = this.buildRebuyPauseFooter(windowMs)
        for (const [playerId, offer] of this.rebuyOffers.entries()) {
            const message = offer?.message
            if (!message || !Array.isArray(message.embeds) || message.embeds.length === 0) continue
            try {
                const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFooter({ text: footerText })
                await message.edit({
                    embeds: [updatedEmbed],
                    components: message.components || []
                })
            } catch (error) {
                logger.debug("Failed to update rebuy pause footer", {
                    scope: "texasGame",
                    playerId,
                    error: error?.message
                })
            }
        }
    }

    async handleBustedPlayer(player) {
        if (!player) return
        if (!this.canPlayerRebuy(player)) {
            await this.RemovePlayer(player, { skipStop: true, reason: "busted" })
            return
        }

        const windowMs = this.getRebuyWindowMs()
        player.status = player.status || {}
        player.status.pendingRebuy = true
        player.status.rebuyDeadline = Date.now() + windowMs
        player.status.removed = true
        player.status.leftThisHand = true
        player.status.pendingRemoval = false
        player.status.folded = true
        player.status.allIn = false
        player.status.lastAction = { type: "busted", ts: Date.now() }
        player.bets = { current: 0, total: 0 }
        player.stack = Math.max(0, player.stack || 0)

        this.UpdateInGame()

        await this.startRebuyOffer(player, windowMs)
    }

    async waitForPendingRebuys() {
        this.waitingForRebuy = true
        const windowMs = this.getRebuyWindowMs()
        try {
            await this.applyRebuyPauseFooter(windowMs)
        } catch (error) {
            logger.debug("Failed to apply rebuy wait footer", {
                scope: "texasGame",
                error: error?.message
            })
        }
    }

    async startRebuyOffer(player, windowMs) {
        if (!this.channel || typeof this.channel.send !== "function") return

        // Cancel any existing offer for this player
        const existing = this.rebuyOffers.get(player.id)
        if (existing?.collector && !existing.collector.ended) {
            try {
                existing.collector.stop("replaced")
            } catch (_) { /* ignore */ }
        }

        const customId = `tx_rebuy:${player.id}:${Date.now()}`
        const playerLabel = player.tag || player.username || player
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        const embed = new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle("💸 Rebuy available")
            .setDescription(`${playerLabel} ran out of chips.\nYou have **${seconds}s** to rebuy and stay in the game.`)

        if (this.waitingForRebuy) {
            embed.setFooter({ text: this.buildRebuyPauseFooter(windowMs) })
        }

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
                allowedMentions: { parse: [] }
            })
        } catch (error) {
            logger.warn("Failed to send rebuy offer", {
                scope: "texasGame",
                playerId: player?.id,
                error: error?.message
            })
            return
        }

        const filter = withAccessGuard(
            (interaction) => interaction.customId === customId,
            { scope: "texas:rebuy" }
        )

        const collector = message.createMessageComponentCollector({
            time: windowMs,
            filter
        })

        collector.on("collect", async (interaction) => {
            if (interaction.user?.id !== player.id) {
                await this.respondEphemeral(interaction, { content: "❌ Only this player can rebuy." })
                return
            }

            const modalId = `tx_rebuy_modal:${interaction.id}`
            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle("Rebuy amount")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("amount")
                            .setLabel("Buy-in amount")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(String(this.minBuyIn))
                    )
                )

            try {
                await interaction.showModal(modal)
            } catch (error) {
                logger.warn("Failed to show rebuy modal", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
                return
            }

            let submission = null
            try {
                submission = await interaction.awaitModalSubmit({
                    time: config.texas.modalTimeout.default,
                    filter: withAccessGuard(
                        (i) => i.customId === modalId && i.user.id === interaction.user.id,
                        { scope: "texas:rebuyModal" }
                    )
                })
            } catch (_) {
                return
            }

            if (!submission) return

            const parsed = features.inputConverter(submission.fields.getTextInputValue("amount"))
            const buyInResult = bankrollManager.normalizeBuyIn({
                requested: parsed,
                minBuyIn: this.minBuyIn,
                maxBuyIn: this.maxBuyIn,
                bankroll: bankrollManager.getBankroll(submission.user)
            })

            if (!buyInResult.ok) {
                await this.respondEphemeral(submission, {
                    content: `❌ ${buyInResult.reason === "insufficientBankroll" ? "Not enough bankroll for this rebuy." : "Invalid amount."}`
                })
                return
            }

            // Apply rebuy
            try {
                submission.user.data.money = bankrollManager.getBankroll(submission.user) - buyInResult.amount
                player.stack = buyInResult.amount
                const resumeNow = Boolean(this.waitingForRebuy)
                player.status.pendingRebuy = false
                player.status.pendingRemoval = false
                player.status.pendingRejoin = resumeNow ? false : true
                player.status.removed = resumeNow ? false : true
                player.status.leftThisHand = true
                player.status.folded = true
                player.status.allIn = false
                player.status.movedone = true
                player.bets = { current: 0, total: 0 }
                player.status.lastAction = { type: "rebuy", amount: buyInResult.amount, ts: Date.now() }
                player.rebuysUsed = (Number(player.rebuysUsed) || 0) + 1

                await this.dataHandler.updateUserData(submission.user.id, this.dataHandler.resolveDBUser(submission.user))

                await this.respondEphemeral(submission, {
                    content: `✅ Rebuy successful: **${setSeparator(buyInResult.amount)}$**.`
                })

                // Update the original rebuy message: disable button and show resume info
                if (message) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        ButtonBuilder.from(row.components[0]).setDisabled(true)
                    )
                    const resumedEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                        .setDescription(`✅ ${playerLabel} rejoined with **${setSeparator(buyInResult.amount)}$**.`)
                        .setFooter({ text: "▶️ Game resumed" })
                        .setColor(Colors.Green)
                    await message.edit({
                        embeds: [resumedEmbed],
                        components: [disabledRow]
                    }).catch(() => null)
                }

                try {
                    collector.stop("completed")
                } catch (_) { /* ignore */ }

                await this.onRebuyCompleted(player)
            } catch (error) {
                logger.warn("Failed to process rebuy", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
                await this.respondEphemeral(submission, {
                    content: "❌ Rebuy failed. Please try again."
                })
            }
        })

        collector.on("end", async (_collected, reason) => {
            try {
                const disabled = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(row.components[0]).setDisabled(true)
                )
                await message.edit({ components: [disabled] }).catch(() => null)
            } catch (_) { /* ignore */ }

            this.rebuyOffers.delete(player.id)
            if (reason !== "completed" && reason !== "replaced") {
                await this.onRebuyExpired(player)
            }
        })

        this.rebuyOffers.set(player.id, { message, collector, expiresAt: Date.now() + windowMs })
    }

    async onRebuyExpired(player) {
        if (!player?.status?.pendingRebuy) return
        player.status.pendingRebuy = false
        player.status.removed = true
        player.status.leftThisHand = true
        player.status.pendingRemoval = false
        player.status.rebuyDeadline = null

        this.UpdateInGame()
        await this.evaluateRebuyState()
    }

    async onRebuyCompleted(player) {
        this.UpdateInGame()
        await this.evaluateRebuyState()
    }

    async evaluateRebuyState() {
        const activePlayers = this.players.filter((p) =>
            (!p.status?.removed || p.status?.pendingRejoin) &&
            !p.status?.pendingRemoval &&
            !p.status?.pendingRebuy
        )
        const pendingRebuys = this.players.filter((p) => p.status?.pendingRebuy)

        if (activePlayers.length >= this.getMinimumPlayers()) {
            if (this.waitingForRebuy) {
                this.waitingForRebuy = false
                if (!this.awaitingPlayerId && !this.timer) {
                    try {
                        await this.StartGame()
                    } catch (error) {
                        logger.warn("Failed to restart game after rebuy", {
                            scope: "texasGame",
                            error: error?.message
                        })
                    }
                }
            }
            return
        }

        if (pendingRebuys.length > 0) {
            this.waitingForRebuy = true
            try {
                await this.applyRebuyPauseFooter(this.getRebuyWindowMs())
            } catch (error) {
                logger.debug("Failed to refresh rebuy footer while waiting", {
                    scope: "texasGame",
                    error: error?.message
                })
            }
            return
        }

        // No pending rebuys and not enough players
        try {
            await this.Stop({ reason: "notEnoughPlayers" })
        } catch (error) {
            logger.warn("Failed to stop after rebuy expiration", {
                scope: "texasGame",
                error: error?.message
            })
        }
    }

    async RemovePlayer(player, options = {}) {
        const { skipStop = false, stopOptions = {}, forceRemove = false, reason = "left" } = options;
        const playerId = typeof player === "object" ? player?.id : player;
        if (!playerId) return false;
        const existing = this.GetPlayer(playerId);
        if (!existing) return false;

        const wasCurrentPlayer = this.awaitingPlayerId === playerId;

        existing.status = existing.status || {};
        existing.status.removed = true;
        existing.status.leftThisHand = true;
        existing.status.pendingRemoval = this.playing && !forceRemove;

        if (existing.stack > 0) {
            bankrollManager.syncStackToBankroll(existing);
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing));
        }

        if (Array.isArray(this.actionOrder) && this.actionOrder.length) {
            this.actionOrder = this.actionOrder.filter((id) => id !== playerId)
            if (!this.actionOrder.length) {
                this.actionCursor = -1
            } else if (this.actionCursor >= this.actionOrder.length) {
                this.actionCursor = this.actionOrder.length - 1
            }
        }

        if (!this.playing || forceRemove) {
            this.players = this.players.filter((p) => p.id !== playerId);
        }

        this.UpdateInGame()

        // Send notice when player leaves during active game
        if (this.playing && !forceRemove) {
            await this.sendPlayerLeftNotice(existing, reason)
        }

        // Check minimum players (count only active, not removed)
        const activeCount = this.players.filter(p => !p.status?.removed && !p.status?.pendingRebuy).length
        const pendingRebuys = this.players.filter(p => p.status?.pendingRebuy).length
        if (!skipStop && activeCount < this.getMinimumPlayers() && this.playing) {
            if (pendingRebuys > 0) {
                this.waitingForRebuy = true
                await this.waitForPendingRebuys()
                return true
            }
            // Update render to show LEFT badge before stopping
            try {
                const finalSnapshot = await this.captureTableRender({
                    title: "Game Over",
                    showdown: false
                })
                if (finalSnapshot && this.gameMessage) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors.DarkGrey)
                        .setTitle(`Texas Hold'em - Round #${this.hands}`)
                        .setDescription("Not enough players to continue.")
                        .addFields(...this.buildInfoAndTimelineFields({ toCall: 0 }))
                        .setImage(`attachment://${finalSnapshot.filename}`)
                    await this.gameMessage.edit({
                        embeds: [embed],
                        files: [finalSnapshot.attachment],
                        components: []
                    }).catch(() => null)
                }
            } catch (error) {
                logger.debug("Failed to update final render on player leave", {
                    scope: "texasGame",
                    error: error?.message
                })
            }

            // Stop the game
            try {
                await this.Stop({ reason: "notEnoughPlayers", ...stopOptions })
            } catch (error) {
                logger.error("Failed to stop Texas table after player removal", {
                    scope: "texasGame",
                    channelId: this.channel?.id,
                    playerId,
                    error: error?.message
                })
            }
            return true
        }

        // Only advance hand if game is still playing and this was the current player
        if (this.awaitingPlayerId === playerId) {
            this.awaitingPlayerId = null
        }
        if (wasCurrentPlayer && this.playing) {
            try {
                await this.advanceHand()
            } catch (error) {
                logger.warn("Failed to advance hand after player removal", {
                    scope: "texasGame",
                    playerId,
                    error: error?.message
                })
            }
        }

        return true
    }

    async SendMessage(type, options = {}) {
        if (type !== "handEnded") return
        const channel = this.channel
        const showdownRender = options.showdown !== undefined ? options.showdown : true
        const revealWinnerId = options.revealWinnerId || null
        const revealWinner = revealWinnerId ? this.GetPlayer(revealWinnerId) : null
        const sendEmbed = async (embed, components = []) => {
            try {
                return await channel.send({ embeds: [embed], components })
            } catch (error) {
                logger.error(`Failed to send Texas message (type: ${type})`, { error })
                return null
            }
        }

        const eligiblePlayers = (this.players || []).filter((p) => {
            if (!p) return false
            const status = p.status || {}
            if (status.pendingRemoval || status.pendingRebuy) return false
            if (status.removed && !status.pendingRejoin) return false
            return true
        })
        const footerText = !this.waitingForRebuy && eligiblePlayers.length <= 1
            ? "🏆 Game over: Only 1 player remaining!"
            : "Showdown complete"
        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle(`Hand #${this.hands} Ended`)
            .setFooter({ text: footerText })

        embed.addFields(...this.buildInfoAndTimelineFields({ toCall: 0 }))

        // Always render showdown, even with 1 player remaining (for all-in scenarios)
        let snapshot = null
        // Reset player bets to 0 for showdown render (avoid confusion with pot)
        this.inGamePlayers.forEach(p => {
            p.bets.current = 0
        })

        snapshot = await this.captureTableRender({
            title: showdownRender ? "Showdown" : "Hand Complete",
            showdown: showdownRender,
            focusPlayerId: revealWinnerId,
            revealFocusCards: showdownRender && Boolean(revealWinnerId)
        })
        if (!snapshot) {
            logger.warn("Texas table snapshot missing for showdown", {
                scope: "texasGame",
                hand: this.hands,
                showdownRender,
                revealWinnerId
            })
        }

        const messagePayload = {
            embeds: [embed],
            files: snapshot ? [snapshot.attachment] : [],
            components: []
        }
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
        }

        const revealRow = []
        if (revealWinner && !showdownRender && revealWinner.user && !revealWinner.user.bot) {
            revealRow.push(
                new ButtonBuilder()
                    .setCustomId(`tx_reveal:${this.hands}:${revealWinner.id}`)
                    .setLabel("Reveal winning hand")
                    .setStyle(ButtonStyle.Primary)
            )
        }
        const leaveRow = new ButtonBuilder()
            .setCustomId(`tx_action:leave:${revealWinnerId || "any"}`)
            .setLabel("Leave")
            .setStyle(ButtonStyle.Secondary)

        const combinedRow = new ActionRowBuilder()
        if (revealRow.length) revealRow.forEach(btn => combinedRow.addComponents(btn))
        combinedRow.addComponents(leaveRow.setStyle(ButtonStyle.Danger))
        messagePayload.components.push(combinedRow)

        let message = this.gameMessage
        if (message) {
            try {
                await message.edit(messagePayload)
            } catch {
                message = null
            }
        }
        if (!message) {
            message = await channel.send(messagePayload).catch(() => null)
            if (message) {
                this.gameMessage = message
            }
        }
        if (!message) {
            await sendEmbed(embed)
            return
        }

        if (messagePayload.components.length === 0) return

        await new Promise((resolve) => {
            const revealRequests = new Map()
            const collector = message.createMessageComponentCollector({
                time: 10_000,
                filter: (i) => i.customId === `tx_reveal:${this.hands}:${revealWinnerId}` || i.customId === `tx_action:leave:${revealWinnerId || "any"}`
            })

            collector.on("collect", async (interaction) => {
                if (interaction.customId.startsWith("tx_action:leave")) {
                    const player = this.GetPlayer(interaction.user.id)
                    if (player) {
                        await interaction.deferUpdate().catch(() => null)
                        await this.RemovePlayer(player, { skipStop: false })
                        await this.respondEphemeral(interaction, { content: "✅ You left the table." })
                    } else {
                        await this.respondEphemeral(interaction, { content: "⚠️ You are not seated at this table." })
                    }
                    return
                }
                revealRequests.set(interaction.user.id, interaction)
                await interaction.deferUpdate().catch(() => null)
            })

            collector.on("end", async () => {
                const components = messagePayload.components.map((row) => {
                    const updatedRow = ActionRowBuilder.from(row)
                    updatedRow.components = row.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
                    return updatedRow
                })

                let updatedEmbed = EmbedBuilder.from(embed)
                let updatedFiles = messagePayload.files

                if (revealRequests.size > 0) {
                    const revealPlayerIds = Array.from(revealRequests.keys())
                    let revealedSnapshot = null
                    try {
                        revealedSnapshot = await this.captureTableRender({
                            title: "Showdown",
                            showdown: false,
                            focusPlayerId: revealWinnerId,
                            revealFocusCards: false,
                            revealPlayerIds
                        })
                    } catch (error) {
                        logger.warn("Failed to capture reveal snapshot", {
                            scope: "texasGame",
                            hand: this.hands,
                            error: error?.message
                        })
                    }

                    if (revealedSnapshot) {
                        updatedEmbed.setImage(`attachment://${revealedSnapshot.filename}`)
                        updatedFiles = [revealedSnapshot.attachment]
                    } else {
                        updatedEmbed.setImage(null)
                    }

                    for (const [, interaction] of revealRequests.entries()) {
                        // No follow-up message needed; the main render is already updated
                    }
                }

                await message.edit({
                    embeds: [updatedEmbed],
                    files: updatedFiles,
                    components
                }).catch(() => null)
                resolve()
            })
        })

        // Auto-clean previous hand summary if enabled
        if (this.settings?.autoCleanHands && this.lastHandMessage && this.lastHandMessage.id !== message.id) {
            try { await this.lastHandMessage.delete().catch(() => null) } catch (_) { /* ignore */ }
        }
        this.lastHandMessage = message
    }

    /**
     * captureTableRender(options): render the table state as a PNG.
     *
     * Delegates to the renderer.
     */
    async captureTableRender(options = {}) {
        return this.renderer.captureTableRender(options)
    }

    async updateInactivityEmbed() {
        const notice = "♠️ Table closed for inactivity: no player acted for two consecutive hands."
        const existingMessage = this.gameMessage
        const existingEmbed = existingMessage?.embeds?.[0]

        let embed = null
        try {
            embed = existingEmbed ? EmbedBuilder.from(existingEmbed) : new EmbedBuilder()
        } catch (_) {
            embed = new EmbedBuilder()
        }
        embed.setColor(Colors.DarkGrey).setFooter({ text: notice })
        if (!embed.data?.title) {
            embed.setTitle("Texas Hold'em - Game closed")
        }
        if (!embed.data?.description) {
            embed.setDescription("Game stopped due to inactivity.")
        }

        const payload = { embeds: [embed], components: [] }
        if (existingMessage) {
            await existingMessage.edit(payload).catch(() => null)
        } else if (this.channel && typeof this.channel.send === "function") {
            await this.channel.send(payload).catch(() => null)
        }
    }

    async updateGameMessage(player, options = {}) {
        const availableOptions = Array.isArray(options.availableOptions)
            ? options.availableOptions
            : await this.GetAvailableOptions(player)
        const paused = Boolean(options.remotePaused || (this.isRemotePauseActive && this.isRemotePauseActive()))
        const components = []
        if (!options.hideActions && !paused) {
            const row = new ActionRowBuilder()
            if (availableOptions.includes("fold")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:fold:${player.id}`).setLabel("Fold").setStyle(ButtonStyle.Danger))
            }
            if (availableOptions.includes("check")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:check:${player.id}`).setLabel("Check").setStyle(ButtonStyle.Secondary))
            }
            if (availableOptions.includes("call")) {
                const callAmount = Math.max(0, this.bets.currentMax - player.bets.current)
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:call:${player.id}`).setLabel(`Call (${setSeparator(callAmount)})`).setStyle(ButtonStyle.Success))
            }
            if (availableOptions.includes("bet")) {
                const minBet = this.getTableMinBet()
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:bet_fixed:${player.id}:${minBet}`).setLabel(`Bet (${setSeparator(minBet)})`).setStyle(ButtonStyle.Primary))
            }
            if (availableOptions.includes("raise")) {
                const minRaiseTotal = this.bets.currentMax + this.bets.minRaise
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:raise_fixed:${player.id}:${minRaiseTotal}`).setLabel(`Raise (${setSeparator(minRaiseTotal)})`).setStyle(ButtonStyle.Primary))
            }
            if (availableOptions.includes("allin")) {
                const toCall = Math.max(0, this.bets.currentMax - player.bets.current)
                const callIsAllIn = availableOptions.includes("call") && toCall >= player.stack
                if (!callIsAllIn) {
                    row.addComponents(new ButtonBuilder().setCustomId(`tx_action:allin:${player.id}`).setLabel(`All-in (${setSeparator(player.stack)})`).setStyle(ButtonStyle.Danger))
                }
            }
            if (availableOptions.includes("leave")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:leave:${player.id}`).setLabel("Leave").setStyle(ButtonStyle.Danger))
            }
            if (row.components.length > 0) components.push(row)

            if (availableOptions.includes("bet") || availableOptions.includes("raise")) {
                const customRow = new ActionRowBuilder()
                customRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`tx_action:custom:${player.id}`)
                        .setLabel("Custom amount")
                        .setStyle(ButtonStyle.Secondary)
                )
                components.push(customRow)
            }
        }

        // Freeze render when only 1 player remains in game (keep last valid snapshot)
        let snapshot = null
        if (this.inGamePlayers.length >= 2) {
            snapshot = await this.captureTableRender({ title: `${player.tag}'s turn`, focusPlayerId: player.id })
            if (snapshot) {
                this.lastValidSnapshot = snapshot
            }
            if (!snapshot) {
                logger.warn("Texas action snapshot missing", {
                    scope: "texasGame",
                    hand: this.hands,
                    playerId: player?.id
                })
            }
        } else if (this.lastValidSnapshot) {
            // Reuse last valid snapshot when only 1 player left
            snapshot = this.lastValidSnapshot
        }
        const currentBet = player.bets?.current || 0
        const toCall = Math.max(0, this.bets.currentMax - currentBet)
        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`Texas Hold'em - Round #${this.hands}`)

        const footerParts = [
            `Round #${this.hands}`,
            `${Math.round(this.actionTimeoutMs / 1000)}s per turn`
        ]
        if (paused) {
            footerParts.push("Remote pause active")
        }
        if (this.inactiveHands >= 1 && !this.currentHandHasInteraction) {
            footerParts.push("⚠️ No recent actions: table may close soon")
        }
        embed.setFooter({ text: footerParts.join(" | ") })
        if (paused) {
            embed.setColor(Colors.DarkGrey)
        }

        // Add Info field with Small/Big blind
        embed.addFields(...this.buildInfoAndTimelineFields({ toCall }))

        if (paused) {
            embed.setDescription("⏸️ Table paused by admins. Please wait.")
        }

        const payload = { embeds: [embed], components, files: [], attachments: [] }

        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            payload.files.push(snapshot.attachment)
        }

        // Edit existing message if available, otherwise send new
        if (this.gameMessage) {
            try {
                await this.gameMessage.edit(payload)
            } catch {
                this.gameMessage = null
            }
        }
        if (!this.gameMessage) {
            this.gameMessage = await this.channel.send(payload).catch(() => null)
        }

        // Send hole cards AFTER the table render, and wait for probability calculation
        if (!this.holeCardsSent) {
            // Wait for pending probability calculation to complete (if any)
            if (this.pendingProbabilityTask) {
                try {
                    await this.pendingProbabilityTask
                } catch {
                    // Probability calculation failed, continue without it
                }
            }
            await this.remindAllPlayersHoleCards()
            this.holeCardsSent = true
        }
    }

    /**
     * respondEphemeral(interaction, payload, options): send an ephemeral message.
     *
     * Delegates to MessageManagement.
     */
    async respondEphemeral(interaction, payload = {}, options = {}) {
        return this.messages.respondEphemeral(interaction, payload, options)
    }
    
    /**
     * sendHoleCardsReminder(player, options): send a reminder with the player's hole cards.
     *
     * Delegates to MessageManagement.
     */
    async sendHoleCardsReminder(player, options = {}) {
        return this.messages.sendHoleCardsReminder(player, options)
    }

    /**
     * remindAllPlayersHoleCards(): send hole card reminders to all players.
     *
     * Delegates to MessageManagement.
     */
    async remindAllPlayersHoleCards() {
        return this.messages.remindAllPlayersHoleCards()
    }

    async StartGame() {
        await this.Reset()
        this.Shuffle(this.cards)
        const eligiblePlayers = (this.players || []).filter((p) => {
            if (!p) return false
            if (p.status?.pendingRebuy) return false
            if (p.status?.pendingRemoval) return false
            if (p.status?.removed && !p.status?.pendingRejoin) return false
            return true
        })
        const seats = [...eligiblePlayers]
        const seatCount = seats.length
        if (seatCount > 0) {
            this.dealerOffset = (this.dealerOffset + 1) % seatCount
            this.inGamePlayers = await this.Rotate(seats, this.dealerOffset)
            this.currentHandOrder = this.inGamePlayers.map((p) => p.id)
        } else {
            this.inGamePlayers = []
            this.currentHandOrder = []
        }

        for (const player of this.inGamePlayers) {
            player.status = createPlayerStatus()
            player.bets = { current: 0, total: 0 }
            player.hand = null
            player.cards = await this.PickRandom(this.cards, 2)
            if (player.status) {
                player.status.pendingRejoin = false
            }
            if (!Number.isFinite(player.rebuysUsed)) {
                player.rebuysUsed = 0
            }
        }

        // Hole cards will be sent after the table render in updateGameMessage
        this.holeCardsSent = false

        const tableMinBet = this.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        const sbPlayer = this.inGamePlayers[0]
        const bbPlayer = this.inGamePlayers[1]

        this.currentSmallBlindId = sbPlayer?.id || null
        this.currentBigBlindId = bbPlayer?.id || null

        if (sbPlayer) {
            await this.Action("bet", sbPlayer, smallBlind, { isBlind: true, skipAdvance: true })
        }
        if (bbPlayer) {
            await this.Action("bet", bbPlayer, tableMinBet, { isBlind: true, skipAdvance: true })
        }

        this.UpdateInGame()
        this.updateActionOrder(this.getBettingStartIndex())

        this.hands++
        this.currentHandHasInteraction = false
        this.gameMessage = null  // Reset for new round - will send new message for each action
        const transitionDelay = Math.max(0, Math.min(config.texas.nextHandDelay.default, 2000))
        if (transitionDelay > 0) {
            await sleep(transitionDelay)
        }

        if (!this.actionCollector) this.CreateOptions()
        this.queueProbabilityUpdate("hand:start")
        const startingPlayer = this.findNextPendingPlayer() || this.inGamePlayers.find(p => !p.status.folded)
        if (startingPlayer) {
            await this.NextPlayer(startingPlayer)
        }
    }

    /**
     * NextHand(): prepare the next hand.
     *
     * Delegates to HandProgression.
     */
    async NextHand() {
        return this.progression.NextHand()
    }

    /**
     * resetBettingRound(): reset bets for a new round.
     *
     * Delegates to BettingEngine.
     */
    resetBettingRound() {
        return this.betting.resetBettingRound()
    }

    async burnCard() {
        await this.PickRandom(this.cards, 1)
    }

    getBettingStartIndex() {
        const players = this.inGamePlayers || []
        if (!players.length) return 0
        if (this.tableCards.length === 0) {
            if (players.length <= 2) return 0
            return Math.min(2, players.length - 1)
        }
        return 0
    }

    updateActionOrder(startIndex = 0) {
        const players = (this.inGamePlayers || []).filter((player) => !player.status?.removed)
        if (!players.length) {
            this.actionOrder = []
            this.actionCursor = -1
            return
        }
        const normalized = ((startIndex % players.length) + players.length) % players.length
        const ordered = players.slice(normalized).concat(players.slice(0, normalized))
        this.actionOrder = ordered.map((player) => player.id)
        this.actionCursor = this.actionOrder.length - 1
    }

    /**
     * resolveNextPhase(): determine the next phase based on the table cards.
     *
     * Delegates to HandProgression.
     */
    resolveNextPhase() {
        return this.progression.resolveNextPhase()
    }

    /**
     * NextPhase(phase): advance to a specific phase (flop, turn, river, showdown).
     *
     * Delegates to HandProgression for game flow logic.
     */
    async NextPhase(phase) {
        return this.progression.NextPhase(phase)
    }

    CreateOptions() {
        const actionFilter = withAccessGuard(
            (i) => {
                if (!i?.customId) return false
                if (!i.customId.startsWith("tx_action:")) return false
                return Boolean(this.GetPlayer(i.user.id))
            },
            { scope: "texas:actions" }
        )
        this.actionCollector = this.channel.createMessageComponentCollector({
            filter: actionFilter,
            time: config.texas.collectorTimeout.default
        })

        this.actionCollector.on("collect", async (interaction) => {
            const parts = interaction.customId.split(':')
            const [, action, playerIdRaw, rawAmount] = parts
            const resolvedPlayerId = action === "leave" && playerIdRaw === "any" ? interaction.user.id : playerIdRaw
            const player = this.GetPlayer(resolvedPlayerId)
            if (this.isRemotePauseActive && this.isRemotePauseActive()) {
                await this.respondEphemeral(interaction, {
                    content: "⏸️ Table paused by admins. Please wait for resume."
                })
                return
            }
            if (!player) {
                await this.respondEphemeral(interaction, { content: "⚠️ You are not seated at this table." })
                return
            }
            if (interaction.user.id !== player.id) {
                await this.respondEphemeral(interaction, { content: "❌ You can only act for your own seat." })
                return
            }
            if (action !== "leave" && this.awaitingPlayerId && interaction.user.id !== this.awaitingPlayerId) {
                await this.respondEphemeral(interaction, { content: "❌ It's not your turn." })
                return
            }

            this.rememberPlayerInteraction(player, interaction)

            let amount = null
            let actionType = action

            if (action === "custom") {
                const modalCustomId = `tx_modal:${interaction.id}`
                const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle("Custom amount")
                const amountInput = new TextInputBuilder().setCustomId("amount").setLabel("Amount").setStyle(TextInputStyle.Short).setRequired(true)
                modal.addComponents(new ActionRowBuilder().addComponents(amountInput))

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    buildTexasInteractionLog(interaction, "Failed to show Texas custom modal", { action, playerId, error: error?.message })
                    return
                }

                const submission = await interaction.awaitModalSubmit({
                    time: config.texas.modalTimeout.default,
                    filter: withAccessGuard(
                        (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
                        { scope: "texas:customModal" }
                    )
                }).catch((error) => {
                    buildTexasInteractionLog(interaction, "Failed to await Texas custom modal submission", {
                        phase: "bettingModal",
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })

                if (!submission) return

                this.rememberPlayerInteraction(player, submission)

                const parsed = features.inputConverter(submission.fields.getTextInputValue("amount"))
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    await this.respondEphemeral(submission, { content: "❌ Please enter a valid positive amount." })
                    return
                }
                amount = Math.floor(parsed)

                const canRaise = (await this.GetAvailableOptions(player)).includes("raise")
                actionType = this.bets.currentMax > 0 && canRaise ? "raise" : "bet"

                await submission.deferUpdate().catch((error) => {
                    buildTexasInteractionLog(submission, "Failed to defer Texas custom modal submission", {
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })
            } else if (action === "bet" || action === "raise" || action === "bet_fixed" || action === "raise_fixed") {
                const parsed = features.inputConverter(rawAmount)
                amount = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
                actionType = action.startsWith("bet") ? "bet" : "raise"
                const modalCustomId = `tx_modal:${interaction.id}`
                if (!Number.isFinite(amount)) {
                    await interaction.deferUpdate().catch(() => null)
                    await this.respondEphemeral(interaction, { content: "❌ Invalid amount for bet/raise." })
                    return
                }
                await interaction.deferUpdate().catch((error) => {
                    buildTexasInteractionLog(interaction, "Failed to defer Texas interaction", {
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })
            } else if (action === "leave") {
                await interaction.deferUpdate().catch(() => null)
                const removed = await this.RemovePlayer(player, { skipStop: false })
                if (!removed) {
                    await this.respondEphemeral(interaction, { content: "❌ Unable to leave the table." })
                } else {
                    await this.respondEphemeral(interaction, { content: "✅ You left the table." })
                }
                return
            } else {
                await interaction.deferUpdate().catch((error) => {
                    buildTexasInteractionLog(interaction, "Failed to defer Texas interaction", {
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })
            }

            try {
                await this.Action(actionType, player, amount)
            } catch (error) {
                buildTexasInteractionLog(interaction, "Player action failed", { action, playerId, error: error?.message })
                await this.respondEphemeral(interaction, { content: "❌ Action failed. Please try again." })
            }
        })

        this.actionCollector.on("end", (_collected, reason) => {
            this.actionCollector = null
            const shouldRecreate = this.playing && !["channelDelete", "messageDelete", "guildDelete"].includes(reason)
            if (shouldRecreate) {
                try {
                    this.CreateOptions()
                } catch (error) {
                    logger.warn("Failed to recreate Texas action collector", {
                        scope: "texasGame",
                        reason,
                        error: error?.message
                    })
                }
            }
        })
    }

    /**
     * Action(type, player, params, options): execute a betting action.
     *
     * Delegates execution to the BettingEngine and handles only the game flow.
     */
    async Action(type, player, params, options = {}) {
        const { isBlind = false, skipAdvance = false } = options

        if (!player || player.status?.removed) return

        try {
            // Pre-action validation
            if (!isBlind) {
                if (this.awaitingPlayerId && player.id !== this.awaitingPlayerId) {
                    return
                }
                const available = await this.GetAvailableOptions(player)
                if (!available.includes(type)) return
                this.awaitingPlayerId = null
            }

            if (this.timer) clearTimeout(this.timer)
            this.timer = null

            // Delegated to BettingEngine
            const result = this.betting.executeAction(type, player, params, options)
            if (!result.success) return

            // Log action
            this.appendActionLog(player, type, {
                amount: result.delta > 0 ? result.delta : null,
                total: result.total,
                isBlind
            })

            // Update game state
            this.UpdateInGame()
            this.lockPlayerIfAllOpponentsAllIn(player)

            // If only one player remains
            const activePlayers = this.inGamePlayers.filter((p) => !p.status.folded)
            if (activePlayers.length === 1) {
                await this.progression.handleFoldWin(activePlayers[0])
                return
            }

            // Advance to the next player/phase
            if (!skipAdvance) {
                await this.advanceHand()
            }
        } finally {
            this.queueProbabilityUpdate("playerAction")
        }
    }

    async advanceHand() {
        this.UpdateInGame()
        const pending = this.findNextPendingPlayer()
        if (pending) {
            await this.NextPlayer(pending)
            return
        }
        await this.NextPhase(this.resolveNextPhase())
    }

    findNextPendingPlayer() {
        if (this.actionOrder.length > 0) {
            const len = this.actionOrder.length
            for (let offset = 1; offset <= len; offset++) {
                const idx = (this.actionCursor + offset) % len
                const playerId = this.actionOrder[idx]
                const player = this.GetPlayer(playerId)
                if (this.shouldPromptPlayer(player)) {
                    this.actionCursor = idx
                    return player
                }
            }
        }
        return this.inGamePlayers.find((player) => this.shouldPromptPlayer(player)) || null
    }

    shouldPromptPlayer(player) {
        if (!player) return false
        if (player.status.folded || player.status.removed || player.status.allIn) return false
        if (player.stack <= 0 && player.bets.current >= this.bets.currentMax) return false
        return !player.status.movedone
    }

    resetPlayersAfterAggression(actor) {
        for (const participant of this.players) {
            if (!participant || participant.id === actor.id) continue
            if (participant.status.folded || participant.status.removed || participant.status.allIn) continue
            participant.status.movedone = false
        }
    }

    hasActiveOpponents(player) {
        const currentMax = this.bets?.currentMax ?? 0
        return this.players.some((p) => {
            if (!p || p.id === player.id) return false
            if (p.status?.folded || p.status?.removed || p.status?.pendingRebuy || p.status?.pendingRemoval) return false
            if (p.status?.allIn) return false
            const availableChips = (p.stack || 0) + (p.bets?.current || 0)
            return availableChips > currentMax
        })
    }

    getMaxOpponentTotal(player) {
        let maxTotal = null
        for (const opponent of this.players) {
            if (!opponent || opponent.id === player?.id) continue
            if (opponent.status?.removed || opponent.status?.pendingRemoval || opponent.status?.pendingRebuy) continue
            if (opponent.status?.folded) continue
            const total = (opponent.stack || 0) + (opponent.bets?.current || 0)
            if (maxTotal === null || total > maxTotal) {
                maxTotal = total
            }
        }
        return maxTotal
    }

    hasOpponentWithChips(player) {
        return this.players.some((opponent) => {
            if (!opponent || opponent.id === player?.id) return false
            if (opponent.status?.removed || opponent.status?.pendingRemoval || opponent.status?.pendingRebuy) return false
            if (opponent.status?.folded) return false
            if (opponent.status?.allIn) return false
            const availableChips = (opponent.stack || 0) + (opponent.bets?.current || 0)
            return availableChips > 0
        })
    }

    /**
     * commitChips(player, desiredAmount): move chips from the stack to the bets.
     *
     * Delegates to BettingEngine.
     */
    commitChips(player, desiredAmount) {
        return this.betting.commitChips(player, desiredAmount)
    }

    capTotalToOpponentMax(player, targetTotal) {
        const maxOpponentTotal = this.getMaxOpponentTotal(player)
        if (!Number.isFinite(maxOpponentTotal)) return targetTotal
        const currentBet = player?.bets?.current || 0
        const capped = Math.max(currentBet, Math.min(targetTotal, maxOpponentTotal))
        return capped
    }

    lockPlayerIfAllOpponentsAllIn(player) {
        if (!player || player.status?.allIn || player.status?.folded || player.status?.removed) return
        const opponents = this.players.filter((p) => {
            if (!p || p.id === player.id) return false
            if (p.status?.removed || p.status?.pendingRemoval || p.status?.pendingRebuy) return false
            if (p.status?.folded) return false
            return true
        })
        if (!opponents.length) return
        const opponentsNeedingAction = opponents.filter((p) => !p.status?.allIn)
        if (opponentsNeedingAction.length === 0) {
            player.status.allIn = true
            player.status.lastAllInAmount = player.bets?.total || 0
            player.status.movedone = true
        }
    }

    /**
     * movePlayerToTotal(player, targetTotal): move a player to a target total bet.
     *
     * Delegates to BettingEngine.
     */
    movePlayerToTotal(player, targetTotal) {
        return this.betting.movePlayerToTotal(player, targetTotal)
    }

    async NextPlayer(player) {
        if (!this.playing || !player) return
        this.UpdateInGame()
        if (this.inGamePlayers.length < this.getMinimumPlayers()) return this.NextHand()

        const availableOptions = await this.GetAvailableOptions(player)
        if (!availableOptions.length) {
            player.status.movedone = true
            await this.advanceHand()
            return
        }

        this.awaitingPlayerId = player.id
        if (this.isRemotePauseActive && this.isRemotePauseActive()) {
            await this.updateGameMessage(player, { availableOptions, remotePaused: true })
            return
        }
        await this.updateGameMessage(player, { availableOptions })

        this.timer = setTimeout(async () => {
            try {
                const fallbackOptions = await this.GetAvailableOptions(player)
                const toCall = Math.max(0, this.bets.currentMax - player.bets.current)
                const fallbackAction = toCall === 0
                    ? "check"
                    : fallbackOptions.includes("check")
                        ? "check"
                        : "fold"
                await this.Action(fallbackAction, player)
            } catch (error) {
                logger.warn("Failed to auto-resolve Texas action timeout", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }, this.actionTimeoutMs)
    }

    async GetAvailableOptions(player) {
        if (!player) return []
        if (player.status?.folded || player.status?.removed || player.status?.allIn) return []

        const options = ["fold"]
        const toCall = Math.max(0, this.bets.currentMax - player.bets.current)

        if (toCall === 0) {
            options.push("check")
        } else if (player.stack >= toCall) {
            options.push("call")
        }

        const tableMinBet = this.getTableMinBet()
        const hasOpponentsWithChips = this.hasOpponentWithChips(player)
        if (this.bets.currentMax === 0 && player.stack >= tableMinBet && hasOpponentsWithChips) {
            options.push("bet")
        }

        const currentBet = player.bets?.current || 0
        const maxOpponentTotal = this.getMaxOpponentTotal(player)
        const minRaiseTotal = this.bets.currentMax + this.bets.minRaise
        const playerTotal = (player.stack || 0) + currentBet
        const canRaise =
            this.bets.currentMax > 0 &&
            playerTotal > minRaiseTotal &&
            this.hasActiveOpponents(player)

        if (canRaise) {
            options.push("raise")
        }

        const canAllIn = player.stack > 0 && (
            toCall >= player.stack ||
            (hasOpponentsWithChips && (!Number.isFinite(maxOpponentTotal) || player.stack <= maxOpponentTotal))
        )
        if (canAllIn) {
            options.push("allin")
        }

        options.push("leave")

        return [...new Set(options)]
    }

    UpdateInGame() {
        const orderedIds = Array.isArray(this.currentHandOrder) && this.currentHandOrder.length
            ? this.currentHandOrder
            : (this.players || []).map((p) => p.id)
        const next = []
        for (const id of orderedIds) {
            const player = this.GetPlayer(id)
            if (!player) continue
            if (player.status.folded || player.status.removed) continue
            next.push(player)
        }
        this.inGamePlayers = next
    }

    applyGoldRewards(players = this.players) {
        if (!Array.isArray(players) || players.length === 0) {
            return
        }
        for (const player of players) {
            if (!player || !player.status) continue
            if (!player.status.won) player.status.won = createWonState()
            const grossValue = Number(player.status.won.grossValue) || 0
            const goldAwarded = awardGoldForHand(player, { wonHand: grossValue > 0 })
            if (goldAwarded > 0) {
                const tracked = Number(player.status.won.goldEarned) || 0
                player.status.won.goldEarned = tracked + goldAwarded
            }
        }
    }

    async AssignRewards(player) {
        if (!player || !player.status) return
        const winnings = player.status.won?.grossValue ?? 0
        if (winnings > 0) {
            const netValue = this.GetNetValue(winnings, player)
            player.stack += netValue
            const contribution = Math.max(0, player.status?.totalContribution || 0)
            const netGain = Math.max(0, netValue - contribution)
            if (netGain > 0) {
                recordNetWin(player, netGain)
            }
            player.status.totalContribution = 0
            player.status.won = createWonState()
            if (player.data) {
                player.data.hands_won = (Number(player.data.hands_won) || 0) + 1
            }
        }
        if (player.data) {
            player.data.hands_played = (Number(player.data.hands_played) || 0) + 1
        }
        await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
    }

    GetNetValue(gross) {
        return gross
    }

    async Reset() {
        this.cards = [...cards]
        this.tableCards = []
        this.players = Array.isArray(this.players)
            ? this.players.filter((p) => !p?.status?.pendingRemoval)
            : []
        // Clear leftThisHand flag for new hand
        this.players.forEach((p) => {
            if (p?.status) {
                p.status.leftThisHand = false
            }
        })
        this.bets = { minRaise: this.getTableMinBet(), currentMax: 0, total: 0, pots: [] }
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.awaitingPlayerId = null
        this.actionOrder = []
        this.actionCursor = -1
        this.currentHandHasInteraction = false
        this.holeCardsSent = false
        this.pendingProbabilityTask = null
        this.probabilitySequence = 0
        this.clearProbabilitySnapshot()
        this.actionTimeline = []
        this.lastValidSnapshot = null
        this.currentSmallBlindId = null
        this.currentBigBlindId = null
        this.currentHandOrder = []
    }

    getDisplayedPotValue() {
        const settled = this.bets.pots.reduce((sum, pot) => sum + pot.amount, 0)
        return settled + this.bets.total
    }

    /**
     * buildSidePots(): calculate side pots from current betting.
     *
     * Delegates to BettingEngine.
     */
    buildSidePots() {
        return this.betting.buildSidePots()
    }

    /**
     * distributePots(pots, contenders): distribute pots to winners.
     *
     * Delegates to BettingEngine.
     */
    distributePots(pots, contenders = []) {
        return this.betting.distributePots(pots, contenders)
    }

    /**
     * handleFoldWin(winner): handle the case where everyone except one has folded.
     *
     * Delegates to HandProgression.
     */
    async handleFoldWin(winner) {
        return this.progression.handleFoldWin(winner)
    }

    /**
     * handleShowdown(): evaluate hands and distribute pots.
     *
     * Delegates to HandProgression.
     */
    async handleShowdown() {
        return this.progression.handleShowdown()
    }

    async Stop(options = {}) {
        const { reason = "unknown" } = options

        // Refund outstanding bets from the pot
        const refundedFromPot = this.refundOutstandingBets()

        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ paused: false, stoppedAt: new Date().toISOString() })
        }

        this.playing = false
        this.inactiveHands = 0
        this.currentHandHasInteraction = false
        if (this.actionCollector) this.actionCollector.stop("gameStopped")
        if (this.timer) clearTimeout(this.timer)
        this.channel.game = null
        this.awaitingPlayerId = null
        if (this.client.activeGames) this.client.activeGames.delete(this)

        if (this.gameMessage) {
            try {
                await this.gameMessage.edit({ components: [] })
            } catch (error) {
                logger.debug("Failed to clear Texas game components on stop", {
                    scope: "texasGame",
                    channelId: this.channel?.id,
                    error: error?.message
                })
            }
        }

        // Cleanup rebuy collectors
        for (const [, offer] of this.rebuyOffers.entries()) {
            if (offer?.collector && !offer.collector.ended) {
                try { offer.collector.stop("gameStopped") } catch (_) { /* ignore */ }
            }
        }
        this.rebuyOffers.clear()
        this.waitingForRebuy = false

        // ALWAYS refund players - no exceptions
        // skipRefund parameter is deprecated and ignored for safety
        try {
            await this.refundPlayers()
        } catch (error) {
            logger.error("Failed to refund players on Stop", {
                scope: "texasGame",
                reason,
                error: error?.message
            })
            // Even if refund fails, don't throw - game stops anyway
            // Players won't lose their stack permanently as long as DB eventually syncs
        }
    }

    refundOutstandingBets() {
        if (!this.bets || this.bets.total <= 0) {
            return 0;
        }

        let refunded = 0;
        for (const player of this.players) {
            if (!player) continue;
            if (!player.bets) {
                player.bets = { current: 0, total: 0 };
            }
            const contribution = Math.max(0, player.bets.total || 0);
            if (contribution <= 0) continue;

            player.stack = Math.max(0, (player.stack || 0) + contribution);
            player.bets.current = 0;
            player.bets.total = 0;
            if (player.status) {
                player.status.allIn = false;
                player.status.lastAllInAmount = 0;
                player.status.movedone = false;
            }
            refunded += contribution;
        }

        this.bets.total = 0;
        this.bets.currentMax = 0;
        this.bets.minRaise = this.getTableMinBet();
        this.bets.pots = [];
        return refunded;
    }

    async refundPlayers() {
        for (const player of this.players) {
            if (player.stack > 0) {
                try {
                    bankrollManager.syncStackToBankroll(player)
                    await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
                } catch (error) {
                    logger.warn("Failed to refund individual player", {
                        scope: "texasGame",
                        playerId: player.id,
                        error: error?.message
                    })
                    // Continue refunding other players even if one fails
                }
            }
        }
    }

    getMinimumPlayers() {
        const configured = config?.texas?.minPlayers?.default
        return Number.isFinite(configured) && configured > 1 ? configured : 2
    }

    getTableMinBet() {
        return Number.isFinite(this.minBet) && this.minBet > 0 ? this.minBet : config.texas.minBet.default
    }

    async Run() {
        if (this.players.length < this.getMinimumPlayers()) return this.Stop({ reason: "notEnoughPlayers" })
        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ startedAt: new Date().toISOString(), paused: false })
        }
        this.playing = true
        await this.NextHand()
    }
}
