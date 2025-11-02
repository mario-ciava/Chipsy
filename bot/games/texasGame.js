const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, AttachmentBuilder, MessageFlags } = require("discord.js")
const { Hand } = require('pokersolver')
const features = require("./features.js")
const { sleep } = require("../utils/helpers")
const Game = require("./game.js")
const cards = require("./cards.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../utils/interactionAccess")
const { renderTexasTable, createTexasTableState, renderTexasPlayerPanel } = require("../rendering/texasTableRenderer")
const bankrollManager = require("../utils/bankrollManager")
const { recordNetWin } = require("../utils/netProfitTracker")
const { buildProbabilityField } = require("../utils/probabilityFormatter")
const { hasWinProbabilityInsight } = require("../utils/playerUpgrades")
const config = require("../../config")

const buildTexasInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "texasGame",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const createWonState = () => ({ grossValue: 0, netValue: 0, expEarned: 0 })

const createPlayerStatus = () => ({
    folded: false,
    movedone: false,
    allIn: false,
    removed: false,
    lastAllInAmount: 0,
    lastReminderHand: 0,
    totalContribution: 0,
    won: createWonState()
})

const toSafeInteger = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric <= 0) return 0
    return Math.floor(numeric)
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
    }

    createPlayerSession(user, stackAmount) {
        if (!user) return null;
        const safeDisplayAvatar =
            typeof user.displayAvatarURL === "function"
                ? (options) => user.displayAvatarURL(options)
                : () => null;
        const safeToString =
            typeof user.toString === "function"
                ? () => user.toString()
                : () => (user.id ? `<@${user.id}>` : "Player");
        const tag =
            typeof user.tag === "string"
                ? user.tag
                : typeof user.username === "string"
                ? `${user.username}#${user.discriminator || "0000"}`
                : "Texas Hold'em player";

        const data = user.data ?? {}
        if (!Number.isFinite(data.hands_played)) data.hands_played = 0
        if (!Number.isFinite(data.hands_won)) data.hands_won = 0

        return {
            id: user.id,
            tag,
            username: user.username,
            bot: user.bot,
            data,
            client: user.client,
            stack:
                Number.isFinite(stackAmount) && stackAmount > 0
                    ? Math.floor(stackAmount)
                    : 0,
            newEntry: true,
            toString: safeToString,
            displayAvatarURL: safeDisplayAvatar,
            user,
            status: createPlayerStatus(),
            bets: { current: 0, total: 0 },
            lastInteraction: null
        };
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
        return "dal pannello"
    }

    async sendRemoteControlNotice(kind, meta = {}) {
        if (!this.channel || typeof this.channel.send !== "function") return
        const label = this.getRemoteActorLabel(meta)
        let description = null
        let color = Colors.DarkGrey
        if (kind === "pause") {
            description = `⏸️ Tavolo messo in pausa ${label}.`
            color = Colors.Orange
        } else if (kind === "resume") {
            description = `▶️ Tavolo riattivato ${label}.`
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
            return { ok: false, reason: "Tempo non valido." }
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
                player.status.probabilitySamples = stats.samples ?? 0
            } else {
                delete player.status.winProbability
                delete player.status.tieProbability
                delete player.status.probabilitySamples
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
        if (!player) return null
        const reveal = Boolean(options.showdown || options.revealCards)
        return {
            id: player.id,
            label: player.tag || player.username,
            cards: Array.isArray(player.cards) ? [...player.cards] : [],
            stack: player.stack,
            bet: player.bets?.current ?? 0,
            totalBet: player.bets?.total ?? 0,
            winnings: player.status?.won?.grossValue ?? 0,
            folded: Boolean(player.status?.folded),
            allIn: Boolean(player.status?.allIn),
            eliminated: Boolean(player.status?.removed),
            handRank: player.hand?.name || null,
            allInAmount: player.status?.allIn
                ? Math.max(player.status?.lastAllInAmount || player.bets?.total || 0, 0)
                : null,
            showCards: reveal
        }
    }

    async createPlayerPanelAttachment(player, options = {}) {
        const payload = this.buildPlayerRenderPayload(player, {
            showdown: Boolean(options.showdown),
            revealCards: Boolean(options.revealCards),
            focusPlayerId: player?.id
        })
        if (!payload) return null
        const buffer = await renderTexasPlayerPanel({ player: payload })
        if (!buffer) return null
        const filename = `texas_player_${player?.id || "unknown"}_${Date.now()}.png`
        return {
            filename,
            buffer,
            attachment: new AttachmentBuilder(buffer, { name: filename, description: payload.label })
        }
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
            await this.channel.send({
                content: "♠️ Tavolo chiuso per inattività: nessun giocatore ha agito per due mani consecutive."
            }).catch((error) => {
                logger.warn("Failed to announce Texas inactivity stop", {
                    scope: "texasGame",
                    error: error?.message
                })
                return null
            })
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

        this.players.push(player)
        return true
    }

    async RemovePlayer(player, options = {}) {
        const { skipStop = false, stopOptions = {} } = options;
        const playerId = typeof player === "object" ? player?.id : player;
        if (!playerId) return false;
        const existing = this.GetPlayer(playerId);
        if (!existing) return false;

        existing.status = existing.status || {};
        existing.status.removed = true;

        if (existing.stack > 0) {
            bankrollManager.syncStackToBankroll(existing);
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing));
        }

        this.players = this.players.filter((p) => p.id !== playerId);

        if (Array.isArray(this.actionOrder) && this.actionOrder.length) {
            this.actionOrder = this.actionOrder.filter((id) => id !== playerId)
            if (!this.actionOrder.length) {
                this.actionCursor = -1
            } else if (this.actionCursor >= this.actionOrder.length) {
                this.actionCursor = this.actionOrder.length - 1
            }
        }

        if (this.awaitingPlayerId === playerId) {
            this.awaitingPlayerId = null
            if (this.playing) {
                this.advanceHand().catch((error) => {
                    logger.warn("Failed to advance hand after player removal", {
                        scope: "texasGame",
                        playerId,
                        error: error?.message
                    })
                })
            }
        }

        this.UpdateInGame()

        if (!skipStop && this.players.length < this.getMinimumPlayers() && this.playing) {
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
        }
        return true
    }

    async SendMessage(type) {
        if (type !== "handEnded") return
        const channel = this.channel
        const sendEmbed = async (embed, components = []) => {
            try {
                return await channel.send({ embeds: [embed], components })
            } catch (error) {
                logger.error(`Failed to send Texas message (type: ${type})`, { error })
                return null
            }
        }

        const totalPotValue = this.bets.pots.reduce((sum, pot) => sum + pot.amount, 0)
        const winnersSections = this.bets.pots.map((pot, index) => {
            const name = pot.winners?.length > 1 ? `Pot #${index + 1}` : "Pot"
            const winnerLines = (pot.winners || []).map(({ player: winner, amount }) => {
                const payout = this.GetNetValue(amount, winner)
                return `${winner} wins ${setSeparator(payout)}$`
            })
            return `**${name}**\n${winnerLines.join('\n')}`
        }).filter(Boolean)
        const winnersText = [
            winnersSections.length ? winnersSections.join('\n\n') : "No winners",
            totalPotValue > 0 ? `_Total pot: ${setSeparator(totalPotValue)}$_` : null
        ].filter(Boolean).join('\n\n')

        const participantSummary = this.players.map((p) => {
            if (p.hand) return `${p} - ${p.hand.name}`
            if (p.status?.folded) return `${p} - Folded`
            return `${p} - Cards hidden`
        }).join('\n') || "No active players"

        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle(`Hand #${this.hands} Ended`)
            .setDescription(participantSummary)
            .addFields({ name: "Winner(s)", value: winnersText })
            .setFooter({ text: "Showdown complete" })

        const snapshot = await this.captureTableRender({ title: "Showdown", showdown: true })
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            await channel.send({ embeds: [embed], files: [snapshot.attachment] })
        } else {
            await sendEmbed(embed)
        }
    }

    async captureTableRender(options = {}) {
        const tableMinBet = this.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        const stage = this.tableCards.length === 0
            ? "Pre-Flop"
            : this.tableCards.length === 3
                ? "Flop"
                : this.tableCards.length === 4
                    ? "Turn"
                    : this.tableCards.length >= 5
                        ? "River"
                        : "Showdown"

        const sidePotsSource = Array.isArray(this.bets?.pots) ? this.bets.pots : []
        const state = createTexasTableState({
            boardCards: [...this.tableCards],
            potTotal: this.getDisplayedPotValue(),
            sidePots: sidePotsSource.map((pot) => ({
                amount: pot?.amount || 0,
                winners: (pot?.winners || []).map((winner) => {
                    if (!winner) return null
                    if (winner.player?.id) return winner.player.id
                    return winner.id ?? null
                })
            })),
            round: this.hands,
            stage,
            blinds: `${setSeparator(smallBlind)} / ${setSeparator(tableMinBet)}`,
            players: this.players
                .map((player) => this.buildPlayerRenderPayload(player, {
                    showdown: Boolean(options.showdown),
                    focusPlayerId: options.focusPlayerId
                }))
                .filter(Boolean)
        }, {
            title: options.title || `Round #${this.hands}`,
            focusPlayerId: options.focusPlayerId,
            showdown: Boolean(options.showdown),
            revealFocusCards: Boolean(options.revealFocusCards)
        })

        try {
            const buffer = await renderTexasTable({ sanitizedParams: state, outputFormat: "png" })
            const filename = `texas_table_${this.hands}_${Date.now()}.png`
            return {
                attachment: new AttachmentBuilder(buffer, { name: filename, description: "Texas Hold'em Table" }),
                filename
            }
        } catch (error) {
            logger.error("Failed to render Texas table", { error })
            return null
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
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:call:${player.id}`).setLabel(`Call (${setSeparator(callAmount)})`).setStyle(ButtonStyle.Primary))
            }
            if (availableOptions.includes("bet")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:bet:${player.id}`).setLabel(`Bet (${setSeparator(this.getTableMinBet())})`).setStyle(ButtonStyle.Success))
            }
            if (availableOptions.includes("raise")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:raise:${player.id}`).setLabel(`Raise (min ${setSeparator(this.bets.currentMax + this.bets.minRaise)})`).setStyle(ButtonStyle.Success))
            }
            if (availableOptions.includes("allin")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:allin:${player.id}`).setLabel(`All-in (${setSeparator(player.stack)})`).setStyle(ButtonStyle.Success))
            }
            if (row.components.length > 0) components.push(row)
        }

        const snapshot = await this.captureTableRender({ title: `${player.tag}'s turn`, focusPlayerId: player.id })
        const toCall = Math.max(0, this.bets.currentMax - player.bets.current)
        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`Texas Hold'em — Round #${this.hands}`)
            .addFields(
                { name: "In azione", value: player.toString(), inline: true },
                { name: "Pot", value: `${setSeparator(this.getDisplayedPotValue())}$`, inline: true },
                { name: "Da chiamare", value: `${setSeparator(toCall)}$`, inline: true }
            )

        const footerParts = [
            `Round #${this.hands}`,
            `${Math.round(this.actionTimeoutMs / 1000)}s per turno`
        ]
        if (paused) {
            footerParts.push("Pausa remota attiva")
        }
        if (this.inactiveHands >= 1 && !this.currentHandHasInteraction) {
            footerParts.push("⚠️ Nessuna azione: chiusura imminente")
        }
        embed.setFooter({ text: footerParts.join(" • ") })
        if (paused) {
            embed.setColor(Colors.DarkGrey)
            embed.setDescription("⏸️ Tavolo messo in pausa dagli admin. Attendi istruzioni.")
        }

        const payload = { embeds: [embed], components, files: [], attachments: [] }
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            payload.files.push(snapshot.attachment)
        }

        if (this.gameMessage) {
            try {
                await this.gameMessage.edit(payload)
            } catch (error) {
                logger.warn("Texas action message edit failed, sending fallback", {
                    scope: "texasGame",
                    error: error?.message
                })
                this.gameMessage = await this.channel.send(payload)
            }
        } else {
            this.gameMessage = await this.channel.send(payload)
        }

        if (!this.holeCardsSent) {
            await this.remindAllPlayersHoleCards()
            this.holeCardsSent = true
        } else {
            await this.sendHoleCardsReminder(player, { force: true })
        }
    }

    async respondEphemeral(interaction, payload = {}) {
        if (!interaction || typeof interaction.reply !== "function") return null
        const response = {
            flags: MessageFlags.Ephemeral,
            ...payload
        }

        try {
            if (interaction.deferred || interaction.replied) {
                return await interaction.followUp(response)
            }
            return await interaction.reply(response)
        } catch (error) {
            logger.debug("Failed to send Texas ephemeral response", {
                scope: "texasGame",
                error: error.message
            })
            return null
        }
    }
    
    async sendHoleCardsReminder(player, options = {}) {
        if (!player || !Array.isArray(player.cards) || player.cards.length === 0) return
        if (player.bot) return
        const force = Boolean(options.force)
        if (!force && player.status?.lastReminderHand === this.hands) return

        const interaction = player.lastInteraction
        const canFollowUp = interaction && typeof interaction.followUp === "function"
        if (!canFollowUp) {
            logger.debug("No interaction available for player hole cards reminder", {
                scope: "texasGame",
                playerId: player?.id
            })
        }

        const panel = await this.createPlayerPanelAttachment(player, { revealCards: true })

        const embed = new EmbedBuilder()
            .setColor(Colors.DarkBlue)
            .setTitle("Le tue hole cards")

        if (panel) {
            embed.setImage(`attachment://${panel.filename}`)
        }

        if (hasWinProbabilityInsight(player)) {
            const probabilityField = buildProbabilityField({
                win: player.status?.winProbability,
                tie: player.status?.tieProbability,
                lose: player.status?.loseProbability,
                samples: player.status?.probabilitySamples
            }) || {
                name: "Win probability",
                value: "Calculating...",
                inline: false
            }
            embed.addFields(probabilityField)
        }

        const embedsForEphemeral = [embed]
        const filesForEphemeral = panel ? [panel.attachment] : undefined
        const dmEmbed = EmbedBuilder.from(embed)
        const dmAttachment = panel
            ? new AttachmentBuilder(Buffer.from(panel.buffer), { name: panel.filename, description: embed.data?.title })
            : null

        const ephemeralPayload = {
            embeds: embedsForEphemeral,
            files: filesForEphemeral,
            flags: MessageFlags.Ephemeral
        }

        const dmPayload = {
            content: "Promemoria automatico — queste sono le tue carte attuali:",
            embeds: [dmEmbed],
            files: dmAttachment ? [dmAttachment] : undefined
        }

        let delivered = false
        if (canFollowUp) {
            try {
                await interaction.followUp(ephemeralPayload)
                delivered = true
            } catch (error) {
                logger.debug("Failed to send Texas hole cards reminder via interaction", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }

        if (!delivered && player.user && typeof player.user.send === "function") {
            try {
                await player.user.send(dmPayload)
                delivered = true
            } catch (error) {
                logger.warn("Failed to DM Texas hole cards reminder fallback", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }

        if (delivered && player.status) {
            player.status.lastReminderHand = this.hands
        }
    }

    async remindAllPlayersHoleCards() {
        for (const player of this.players) {
            try {
                await this.sendHoleCardsReminder(player, { force: true })
            } catch (error) {
                logger.debug("Failed to send hole cards reminder", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }
    }

    async StartGame() {
        await this.Reset()
        this.Shuffle(this.cards)
        this.players = await this.Rotate(this.players, 1)
        this.inGamePlayers = [...this.players]

        for (const player of this.inGamePlayers) {
            player.status = createPlayerStatus()
            player.bets = { current: 0, total: 0 }
            player.cards = await this.PickRandom(this.cards, 2)
        }

        const tableMinBet = this.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        const sbPlayer = this.inGamePlayers[0]
        const bbPlayer = this.inGamePlayers[1]

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
        if (!this.playing) return

        await Promise.all(this.players.map((player) => this.AssignRewards(player)))

        const tableMinBet = this.getTableMinBet()
        const bustedPlayers = this.players.filter((p) => p.stack < tableMinBet)
        for (const busted of bustedPlayers) {
            await this.RemovePlayer(busted, { skipStop: true })
        }

        if (this.players.length < this.getMinimumPlayers()) {
            return this.Stop({ reason: "notEnoughPlayers" })
        }

        await this.StartGame()
    }

    resetBettingRound() {
        for (const player of this.players) {
            if (player?.bets) {
                player.bets.current = 0
            }
        }
        this.bets.currentMax = 0
        this.bets.minRaise = this.getTableMinBet()
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
        if (this.tableCards.length === 0) return "flop"
        if (this.tableCards.length === 3) return "turn"
        if (this.tableCards.length === 4) return "river"
        return "showdown"
    }

    async NextPhase(phase) {
        const phases = ["flop", "turn", "river", "showdown"]
        if (!phases.includes(phase)) return

        if (phase === "showdown") {
            await this.handleShowdown()
            return
        }

        if (phase === "flop") {
            await this.burnCard()
            this.tableCards = await this.PickRandom(this.cards, 3)
        } else {
            await this.burnCard()
            const [card] = await this.PickRandom(this.cards, 1)
            if (card) this.tableCards.push(card)
        }

        this.resetBettingRound()
        this.inGamePlayers.forEach((player) => {
            if (!player.status.folded && !player.status.allIn) {
                player.status.movedone = false
            }
        })
        this.UpdateInGame()
        this.updateActionOrder(this.getBettingStartIndex())
        this.queueProbabilityUpdate(`phase:${phase}`)

        const nextPlayer = this.findNextPendingPlayer()
        if (nextPlayer) {
            await this.NextPlayer(nextPlayer)
        } else {
            await this.NextPhase(this.resolveNextPhase())
        }
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
            const [, action, playerId] = interaction.customId.split(':')
            const player = this.GetPlayer(playerId)
            if (this.isRemotePauseActive && this.isRemotePauseActive()) {
                await this.respondEphemeral(interaction, {
                    content: "⏸️ Tavolo in pausa dagli admin. Attendi la ripresa."
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
            if (this.awaitingPlayerId && interaction.user.id !== this.awaitingPlayerId) {
                await this.respondEphemeral(interaction, { content: "❌ It's not your turn." })
                return
            }

            this.rememberPlayerInteraction(player, interaction)

            let amount = null
            if (action === "bet" || action === "raise") {
                const modalCustomId = `tx_modal:${interaction.id}`
                const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(`Amount for ${action}`)
                const amountInput = new TextInputBuilder().setCustomId("amount").setLabel("Amount").setStyle(TextInputStyle.Short).setRequired(true)
                modal.addComponents(new ActionRowBuilder().addComponents(amountInput))

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    buildTexasInteractionLog(interaction, "Failed to show Texas modal", { action, playerId, error: error?.message })
                    return
                }

                const submission = await interaction.awaitModalSubmit({
                    time: config.texas.modalTimeout.default,
                    filter: withAccessGuard(
                        (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
                        { scope: "texas:betModal" }
                    )
                }).catch((error) => {
                    buildTexasInteractionLog(interaction, "Failed to await Texas modal submission", {
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
                await submission.deferUpdate().catch((error) => {
                    buildTexasInteractionLog(submission, "Failed to defer Texas modal submission", {
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })
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
                await this.Action(action, player, amount)
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

            const previousCurrentMax = this.bets.currentMax

            switch (type) {
                case "fold":
                    player.status.folded = true
                    player.status.movedone = true
                    break
                case "check":
                    player.status.movedone = true
                    break
                case "call": {
                    const callAmount = Math.max(0, this.bets.currentMax - player.bets.current)
                    if (callAmount > 0) {
                        this.commitChips(player, callAmount)
                    }
                    player.status.movedone = true
                    break
                }
                case "bet": {
                    const requestedTotal = isBlind
                        ? player.bets.current + toSafeInteger(params)
                        : Math.max(this.getTableMinBet(), toSafeInteger(params) || this.getTableMinBet())
                    this.movePlayerToTotal(player, requestedTotal)
                    player.status.movedone = isBlind ? false : true
                    break
                }
                case "raise": {
                    const minimumTotal = this.bets.currentMax + this.bets.minRaise
                    let requestedTotal = Number.isFinite(params) && params > 0 ? Math.floor(params) : minimumTotal
                    if (requestedTotal < minimumTotal) requestedTotal = minimumTotal
                    this.movePlayerToTotal(player, requestedTotal)
                    player.status.movedone = true
                    break
                }
                case "allin": {
                    if (player.stack > 0) {
                        this.commitChips(player, player.stack)
                    }
                    player.status.movedone = true
                    break
                }
                default:
                    return
            }

            if (player.bets.current > previousCurrentMax) {
                const delta = player.bets.current - previousCurrentMax
                this.bets.currentMax = player.bets.current
                if (delta > 0) {
                    this.bets.minRaise = Math.max(delta, this.getTableMinBet())
                }
                if (!isBlind) {
                    this.resetPlayersAfterAggression(player)
                }
            }

            this.UpdateInGame()

            const activePlayers = this.inGamePlayers.filter((p) => !p.status.folded)
            if (activePlayers.length === 1) {
                await this.handleFoldWin(activePlayers[0])
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
        return this.players.some((p) => {
            if (!p || p.id === player.id) return false
            return !p.status.folded && !p.status.removed
        })
    }

    commitChips(player, desiredAmount) {
        if (!player || desiredAmount <= 0) return 0
        const amount = Math.min(player.stack, Math.floor(desiredAmount))
        if (amount <= 0) return 0
        player.stack -= amount
        player.bets.current += amount
        player.bets.total += amount
        if (player.status) {
            player.status.totalContribution = (player.status.totalContribution || 0) + amount
        }
        this.bets.total += amount
        if (player.stack === 0) {
            player.status.allIn = true
            player.status.lastAllInAmount = Math.max(player.bets.total, 0)
        }
        return amount
    }

    movePlayerToTotal(player, targetTotal) {
        if (!player) return 0
        const maxTotal = player.bets.current + player.stack
        const sanitizedTotal = Math.min(maxTotal, Math.max(player.bets.current, Math.floor(targetTotal)))
        const required = sanitizedTotal - player.bets.current
        if (required <= 0) return 0
        return this.commitChips(player, required)
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
                const fallbackAction = fallbackOptions.includes("check") ? "check" : "fold"
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
        if (this.bets.currentMax === 0 && player.stack >= tableMinBet) {
            options.push("bet")
        }

        const minRaiseTotal = this.bets.currentMax === 0
            ? tableMinBet
            : this.bets.currentMax + this.bets.minRaise

        if (
            player.stack + player.bets.current >= minRaiseTotal &&
            this.hasActiveOpponents(player)
        ) {
            options.push("raise")
        }

        if (player.stack > 0) {
            options.push("allin")
        }

        return [...new Set(options)]
    }

    UpdateInGame() {
        this.inGamePlayers = this.players.filter((p) => !p.status.folded && !p.status.removed)
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
        this.bets = { minRaise: this.getTableMinBet(), currentMax: 0, total: 0, pots: [] }
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.awaitingPlayerId = null
        this.actionOrder = []
        this.actionCursor = -1
        this.currentHandHasInteraction = false
        this.inactiveHands = 0
        this.holeCardsSent = false
        this.pendingProbabilityTask = null
        this.probabilitySequence = 0
        this.clearProbabilitySnapshot()
    }

    getDisplayedPotValue() {
        const settled = this.bets.pots.reduce((sum, pot) => sum + pot.amount, 0)
        return settled + this.bets.total
    }

    buildSidePots() {
        const entries = this.players
            .map((player) => ({
                player,
                remaining: Math.max(0, player.bets?.total || 0),
                eligible: !player.status?.folded && !player.status?.removed
            }))
            .filter((entry) => entry.remaining > 0)
            .sort((a, b) => a.remaining - b.remaining)

        const pots = []
        const working = [...entries]
        while (working.length > 0) {
            const smallest = working[0].remaining
            if (smallest <= 0) {
                working.shift()
                continue
            }
            const contributors = working.filter((entry) => entry.remaining > 0)
            if (!contributors.length) break
            const potAmount = smallest * contributors.length
            const eligiblePlayers = contributors.filter((entry) => entry.eligible).map((entry) => entry.player)
            pots.push({ amount: potAmount, eligiblePlayers })
            for (const entry of contributors) {
                entry.remaining -= smallest
            }
            while (working.length && working[0].remaining <= 0) {
                working.shift()
            }
        }
        return pots
    }

    distributePots(pots, contenders = []) {
        const resolved = []
        for (const pot of pots) {
            const eligiblePlayers = pot.eligiblePlayers.filter(Boolean)
            if (!eligiblePlayers.length) continue

            let winners = eligiblePlayers.filter((player) => {
                return contenders.includes(player) && player.hand
            })

            if (winners.length) {
                const bestHands = Hand.winners(winners.map((player) => player.hand))
                winners = winners.filter((player) => bestHands.includes(player.hand))
            } else {
                winners = eligiblePlayers
            }

            if (!winners.length) continue

            const baseShare = Math.floor(pot.amount / winners.length)
            let remainder = pot.amount - baseShare * winners.length

            const winnerEntries = winners.map((player) => {
                const payout = baseShare + (remainder-- > 0 ? 1 : 0)
                if (!player.status.won) player.status.won = createWonState()
                player.status.won.grossValue += payout
                return { player, amount: payout }
            })

            resolved.push({ amount: pot.amount, winners: winnerEntries })
        }
        return resolved
    }

    async handleFoldWin(winner) {
        if (!winner) return
        if (!winner.status.won) winner.status.won = createWonState()
        winner.status.won.grossValue += this.bets.total
        this.bets.pots = [{ amount: this.bets.total, winners: [{ player: winner, amount: this.bets.total }] }]
        this.bets.total = 0
        this.clearProbabilitySnapshot()
        await this.SendMessage("handEnded")
        const stopped = await this.evaluateHandInactivity()
        if (!stopped) {
            await this.NextHand()
        }
    }

    async handleShowdown() {
        const contenders = this.players.filter((player) => !player.status.folded && !player.status.removed)
        if (!contenders.length) {
            const fallback = this.players.find((p) => !p.status.removed)
            if (fallback) await this.handleFoldWin(fallback)
            else await this.Stop({ reason: "notEnoughPlayers" })
            return
        }

        contenders.forEach((player) => {
            try {
                player.hand = Hand.solve(this.tableCards.concat(player.cards))
            } catch (error) {
                logger.error("Failed to evaluate Texas hand", {
                    scope: "texasGame",
                    playerId: player.id,
                    error: error?.message
                })
                player.hand = null
            }
        })

        const pots = this.buildSidePots()
        const resolved = pots.length ? this.distributePots(pots, contenders) : []

        if (!resolved.length) {
            const defaultWinner = contenders[0]
            if (defaultWinner) {
                if (!defaultWinner.status.won) defaultWinner.status.won = createWonState()
                defaultWinner.status.won.grossValue += this.bets.total
                this.bets.pots = [{ amount: this.bets.total, winners: [{ player: defaultWinner, amount: this.bets.total }] }]
            } else {
                this.bets.pots = []
            }
        } else {
            this.bets.pots = resolved
        }

        this.bets.total = 0
        this.clearProbabilitySnapshot()
        await this.SendMessage("handEnded")
        const stopped = await this.evaluateHandInactivity()
        if (!stopped) {
            await this.NextHand()
        }
    }

    async Stop(options = {}) {
        this.refundOutstandingBets();
        if (typeof this.setRemoteMeta === "function") {
            this.setRemoteMeta({ paused: false, stoppedAt: new Date().toISOString() })
        }

        this.playing = false;
        this.inactiveHands = 0;
        this.currentHandHasInteraction = false;
        if (this.actionCollector) this.actionCollector.stop("gameStopped");
        if (this.timer) clearTimeout(this.timer);
        this.channel.game = null;
        this.awaitingPlayerId = null;
        if (this.client.activeGames) this.client.activeGames.delete(this);

        if (options.skipRefund !== true) {
            await this.refundPlayers();
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
                bankrollManager.syncStackToBankroll(player);
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player));
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
