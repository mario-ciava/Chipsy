const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, MessageFlags } = require("discord.js")
const features = require("../../../shared/features")
const { sleep } = require("../../utils/helpers")
const Game = require("../shared/baseGame.js")
const cards = require("../shared/cards.js")
const setSeparator = require("../../../shared/utils/setSeparator")
const logger = require("../../../shared/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../../utils/interactionAccess")
const bankrollManager = require("../../utils/bankrollManager")
const { recordNetWin } = bankrollManager
const { awardGoldForHand } = require("../../utils/goldRewardManager")
const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
const config = require("../../../config")
const { validateAmount, validateStack, MAX_SAFE_STACK, createPlayerStatus, createPlayerSession: createPlayerSessionSchema } = require("../shared/playerStateSchema")
const BettingEngine = require("./bettingEngine")
const TexasRenderer = require("./texasRenderer")
const HandProgression = require("./handProgression")
const MessageManagement = require("../shared/messageManagement")
const { resolveTexasSettings, defaults: texasSettingDefaults } = require("./settings")
const GameBroadcaster = require("../shared/gameBroadcaster")
const TexasRebuyManager = require("./rebuyManager")
const TexasMessageCoordinator = require("./messageCoordinator")

const buildTexasInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "texasGame",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const createWonState = () => ({ grossValue: 0, netValue: 0, expEarned: 0, goldEarned: 0 })

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
        this.awaitingPlayerId = null
        this.actionOrder = []
        this.actionCursor = -1
        this.currentHandHasInteraction = false
        this.inactiveHands = 0
        this.holeCardsSent = false
        this.pendingProbabilityTask = null
        this.actionTimeline = []
        this.lastValidSnapshot = null
        this.roundMessageFresh = true
        this.rebuyOffers = new Map()
        this.waitingForRebuy = false
        this.rebuyResumeTimer = null
        this.dealerOffset = -1
        this.lastHandMessage = null
        this.currentSmallBlindId = null
        this.currentBigBlindId = null
        this.currentHandOrder = []

        this.betting = new BettingEngine(this)
        this.renderer = new TexasRenderer(this)
        this.progression = new HandProgression(this)
        this.messages = new MessageManagement(this)
        this.rebuyManager = new TexasRebuyManager(this)
        this.messageCoordinator = new TexasMessageCoordinator(this)

        this.broadcaster = new GameBroadcaster(this)
        if (info.message?.channel) {
            this.broadcaster.setPrimaryChannel(info.message.channel)
        }

        this.applySettings(info?.settings)
    }

    inheritLobbyMirrors(lobbySession) {
        this.broadcaster.inheritLobbyMirrors(lobbySession)
    }

    createPlayerSession(user, stackAmount) {
        return createPlayerSessionSchema(user, stackAmount)
    }

    applySettings(overrides = {}) {
        const resolved = resolveTexasSettings({ overrides })
        this.settings = resolved
        if (resolved?.actionTimeoutMs) {
            this.updateActionTimeout(resolved.actionTimeoutMs)
        }
        return resolved
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
        
        await this.broadcaster.notify({
            embeds: [new EmbedBuilder().setColor(color).setDescription(description)]
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

        let actionLabel
        if (type === "fold") actionLabel = "**Fold**"
        else if (type === "check") actionLabel = "**Check**"
        else if (type === "call") actionLabel = "**Call**"
        else if (type === "bet") actionLabel = entry.isBlind ? "**Blind**" : "**Bet**"
        else if (type === "raise") actionLabel = "**Raise**"
        else if (type === "allin") actionLabel = "**All-in**"
        else actionLabel = `**${String(type).charAt(0).toUpperCase() + String(type).slice(1)}**`

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
        if (!Array.isArray(this.actionTimeline) || this.actionTimeline.length === 0) {
            return "No actions yet."
        }

        const lines = this.actionTimeline
            .filter((entry) => !entry?.isBlind)
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

    buildPlayerRenderPayload(player, options = {}) {
        return this.renderer.buildPlayerRenderPayload(player, options)
    }

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

        if (this.GetPlayer(user.id)) {
            user.data.money = currentBankroll
            await this.dataHandler.updateUserData(user.id, this.dataHandler.resolveDBUser(user))
            return false
        }

        this.players.push(player)
        return true
    }

    async sendPlayerLeftNotice(player, reason = "left") {
        try {
            const playerLabel = player.tag || player.username || player.toString()
            const message = reason === "busted"
                ? `💸 ${playerLabel} ran out of chips and left the table.`
                : `🏃 ${playerLabel} left the table.`
            const color = reason === "busted" ? Colors.Red : Colors.Orange
            const embed = new EmbedBuilder()
                .setColor(color)
                .setDescription(message)
            
            await this.broadcaster.notify({
                embeds: [embed]
            })
        } catch (error) {
            logger.warn("Error sending Texas player left notice", {
                scope: "texasGame",
                error: error?.message
            })
        }
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

    buildRebuyPauseFooter(windowMs) {
        return this.rebuyManager.buildRebuyPauseFooter(windowMs)
    }

    async applyRebuyPauseFooter(windowMs) {
        return this.rebuyManager.applyRebuyPauseFooter(windowMs)
    }

    async handleBustedPlayer(player) {
        return this.rebuyManager.handleBustedPlayer(player)
    }

    async waitForPendingRebuys() {
        return this.rebuyManager.waitForPendingRebuys()
    }

    async startRebuyOffer(player, windowMs) {
        return this.rebuyManager.startRebuyOffer(player, windowMs)
    }

    async onRebuyExpired(player) {
        return this.rebuyManager.onRebuyExpired(player)
    }

    async onRebuyCompleted(player) {
        return this.rebuyManager.onRebuyCompleted(player)
    }

    async evaluateRebuyState() {
        return this.rebuyManager.evaluateRebuyState()
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

        if (this.playing && !forceRemove) {
            await this.sendPlayerLeftNotice(existing, reason)
        }

        const activeCount = this.players.filter(p => !p.status?.removed && !p.status?.pendingRebuy).length
        const pendingRebuys = this.players.filter(p => p.status?.pendingRebuy)
        if (!skipStop && activeCount < this.getMinimumPlayers() && this.playing) {
            if (pendingRebuys > 0) {
                this.waitingForRebuy = true
                await this.waitForPendingRebuys()
                return true
            }
            try {
                const finalSnapshot = await this.captureTableRender({
                    title: "Game Over",
                    showdown: false
                })
                if (finalSnapshot) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors.DarkGrey)
                        .setTitle(`Texas Hold'em - Round #${this.hands}`)
                        .setDescription("Not enough players to continue.")
                        .addFields(...this.buildInfoAndTimelineFields({ toCall: 0 }))
                        .setImage(`attachment://${finalSnapshot.filename}`)
                    
                    await this.broadcaster.broadcast({
                        embeds: [embed],
                        files: [finalSnapshot.attachment],
                        components: []
                    })
                }
            } catch (error) {
                logger.debug("Failed to update final render on player leave", {
                    scope: "texasGame",
                    error: error?.message
                })
            }

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
        return this.messageCoordinator.SendMessage(type, options)
    }


    async captureTableRender(options = {}) {
        return this.renderer.captureTableRender(options)
    }

    async updateInactivityEmbed() {
        const notice = "♠️ Table closed for inactivity: no player acted for two consecutive hands."
        
        const embed = new EmbedBuilder()
            .setColor(Colors.DarkGrey)
            .setFooter({ text: notice })
            .setTitle("Texas Hold'em - Game closed")
            .setDescription("Game stopped due to inactivity.")

        const payload = { embeds: [embed], components: [] }
        await this.broadcaster.broadcast(payload)
    }

    async updateGameMessage(player, options = {}) {
        return this.messageCoordinator.updateGameMessage(player, options)
    }


    async respondEphemeral(interaction, payload = {}, options = {}) {
        return this.messages.respondEphemeral(interaction, payload, options)
    }
    
    async sendHoleCardsReminder(player, options = {}) {
        return this.messages.sendHoleCardsReminder(player, options)
    }

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
        this.gameMessage = null
        this.roundMessageFresh = true
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

    async NextHand() {
        return this.progression.NextHand()
    }

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

    resolveNextPhase() {
        return this.progression.resolveNextPhase()
    }

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
        
        this.actionCollector = true
        this.broadcaster.createCollectors({
            filter: actionFilter,
            time: config.texas.collectorTimeout.default
        }, async (interaction) => {
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
        }, (collected, reason) => {
            this.actionCollector = null
            const shouldRecreate = this.playing && !["cleanup", "target_lost"].includes(reason)
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

    async Action(type, player, params, options = {}) {
        const { isBlind = false, skipAdvance = false } = options

        if (!player || player.status?.removed) return

        try {
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

            const result = this.betting.executeAction(type, player, params, options)
            if (!result.success) return

            this.appendActionLog(player, type, {
                amount: result.delta > 0 ? result.delta : null,
                total: result.total,
                isBlind
            })

            this.UpdateInGame()
            this.lockPlayerIfAllOpponentsAllIn(player)

            const activePlayers = this.inGamePlayers.filter((p) => !p.status.folded)
            if (activePlayers.length === 1) {
                await this.progression.handleFoldWin(activePlayers[0])
                return
            }

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

    buildSidePots() {
        return this.betting.buildSidePots()
    }

    distributePots(pots, contenders = []) {
        return this.betting.distributePots(pots, contenders)
    }

    async handleFoldWin(winner) {
        return this.progression.handleFoldWin(winner)
    }

    async handleShowdown() {
        return this.progression.handleShowdown()
    }

    async Stop(options = {}) {
        const { reason = "unknown" } = options

        const refundedFromPot = this.refundOutstandingBets()

        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ paused: false, stoppedAt: new Date().toISOString() })
        }

        this.playing = false
        this.inactiveHands = 0
        this.currentHandHasInteraction = false
        if (this.timer) clearTimeout(this.timer)
        this.channel.game = null
        this.awaitingPlayerId = null
        if (this.client.activeGames) this.client.activeGames.delete(this)

        if (this.broadcaster) {
            this.broadcaster.cleanup()
        }

        for (const [, offer] of this.rebuyOffers.entries()) {
            if (offer?.collector && !offer.collector.ended) {
                try { offer.collector.stop("gameStopped") } catch (_) {}
            }
        }
        this.rebuyOffers.clear()
        this.waitingForRebuy = false

        try {
            await this.refundPlayers()
        } catch (error) {
            logger.error("Failed to refund players on Stop", {
                scope: "texasGame",
                reason,
                error: error?.message
            })
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
