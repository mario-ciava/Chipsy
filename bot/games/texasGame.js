const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder, AttachmentBuilder, MessageFlags } = require("discord.js")
const { Hand } = require('pokersolver')
const features = require("./features.js")
const { sleep } = require("../utils/helpers")
const Game = require("./game.js")
const cards = require("./cards.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = require("../utils/loggingHelpers")
const { renderCardTable, createBlackjackTableState } = require("../rendering/cardTableRenderer")
const bankrollManager = require("../utils/bankrollManager")
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
        this.actionCollector = null
        this.gameMessage = null
        this.awaitingPlayerId = null
        this.actionOrder = []
        this.actionCursor = -1
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
            bets: { current: 0, total: 0 }
        };
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

        this.UpdateInGame()

        if (!skipStop && this.players.length < this.getMinimumPlayers() && this.playing) {
            this.Stop({ reason: "notEnoughPlayers", ...stopOptions })
        }
        return true
    }

    async SendMessage(type, player, info) {
        const channel = this.channel
        const sendEmbed = async (embed, components = []) => {
            try {
                return await channel.send({ embeds: [embed], components })
            } catch (error) {
                logger.error(`Failed to send Texas message (type: ${type})`, { error })
                return null
            }
        }

        switch (type) {
            case 'playerAdded':
            case 'playerRemoved':
                // Handled by lobby, no message needed here
                break
            case 'noMoney':
                await sendEmbed(new EmbedBuilder().setColor(Colors.Red).setFooter({ text: `${player.tag} was removed: no money left.`, iconURL: player.displayAvatarURL({ extension: "png" }) }))
                break
            case 'nextHand':
                await sendEmbed(new EmbedBuilder().setColor(Colors.Blue).setFooter({ text: "Next hand starting in 8 seconds..." }))
                break
            case 'handEnded':
                const totalPotValue = this.bets.pots.reduce((sum, pot) => sum + pot.amount, 0)
                const winnersText = this.bets.pots.map((pot, index) => {
                    const name = pot.winners?.length > 1 ? `Pot #${index + 1}` : "Pot"
                    const winnerLines = (pot.winners || []).map(({ player: winner, amount }) => {
                        const payout = this.GetNetValue(amount, winner)
                        return `${winner} wins ${setSeparator(payout)}$`
                    })
                    return `**${name} (${setSeparator(pot.amount)}$)**\n${winnerLines.join('\n')}`
                }).filter(Boolean).join('\n\n') || "No winners"

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
                    .setFooter({ text: `Total pot: ${setSeparator(totalPotValue)}$` })

                const snapshot = await this.captureTableRender({ title: "Showdown", showdown: true })
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    await channel.send({ embeds: [embed], files: [snapshot.attachment] })
                } else {
                    await sendEmbed(embed)
                }
                break
        }
    }

    async captureTableRender(options = {}) {
        const state = createBlackjackTableState({
            dealer: { cards: this.tableCards, value: this.getDisplayedPotValue() },
            players: this.inGamePlayers.map(p => ({
                ...p,
                hands: [{ cards: p.cards, value: p.bets.current, busted: p.status.folded, BJ: false, push: false }]
            })),
            round: this.hands,
            id: this.id
        }, {
            title: options.title || `Round #${this.hands}`,
            focusPlayerId: options.focusPlayerId,
            showdown: options.showdown
        })

        try {
            const buffer = await renderCardTable({ ...state, outputFormat: "png" })
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
        const components = []
        if (!options.hideActions) {
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
        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`Texas Hold'em - Round #${this.hands}`)
            .setDescription(`It's ${player}'s turn to act.`)
            .setFooter({
                text: `Pot: ${setSeparator(this.getDisplayedPotValue())}$ | ${config.texas.actionTimeout.default / 1000}s left`
            })

        if (this.players.length > 0) {
            const infoRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("tx_hand:view")
                    .setLabel("View Cards")
                    .setStyle(ButtonStyle.Secondary)
            )
            components.push(infoRow)
        }

        const payload = { embeds: [embed], components, files: [], attachments: [] }
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            payload.files.push(snapshot.attachment)
        }

        if (this.gameMessage) {
            await this.gameMessage.edit(payload)
        } else {
            this.gameMessage = await this.channel.send(payload)
        }
    }

    async showPlayerHand(player, interaction) {
        const cards = Array.isArray(player.cards) && player.cards.length > 0
            ? player.cards.join(" ")
            : "Cards are not available yet."

        const embed = new EmbedBuilder()
            .setColor(Colors.DarkBlue)
            .setTitle("Your hole cards")
            .setDescription(cards)
            .setFooter({ text: `Stack: ${setSeparator(player.stack)}$` })

        await this.respondEphemeral(interaction, { embeds: [embed] })
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
        await this.SendMessage("nextHand")
        await sleep(config.texas.nextHandDelay.default)

        if (!this.actionCollector) this.CreateOptions()
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
            this.tableCards = await this.PickRandom(this.cards, 3)
        } else {
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

        const snapshot = await this.captureTableRender({ title: phase.charAt(0).toUpperCase() + phase.slice(1) })
        if (snapshot) {
            const embed = new EmbedBuilder()
                .setColor(Colors.Blue)
                .setTitle(phase.toUpperCase())
                .setImage(`attachment://${snapshot.filename}`)
            await this.channel.send({ embeds: [embed], files: [snapshot.attachment] })
        }

        const nextPlayer = this.findNextPendingPlayer()
        if (nextPlayer) {
            await this.NextPlayer(nextPlayer)
        } else {
            await this.NextPhase(this.resolveNextPhase())
        }
    }

    CreateOptions() {
        this.actionCollector = this.channel.createMessageComponentCollector({
            filter: (i) => {
                if (!i?.customId) return false
                if (!i.customId.startsWith("tx_action:") && i.customId !== "tx_hand:view") return false
                return Boolean(this.GetPlayer(i.user.id))
            },
            time: config.texas.collectorTimeout.default
        })

        this.actionCollector.on("collect", async (interaction) => {
            if (interaction.customId === "tx_hand:view") {
                const seated = this.GetPlayer(interaction.user.id)
                if (!seated) {
                    await this.respondEphemeral(interaction, { content: "⚠️ You are not seated at this table." })
                    return
                }
                await this.showPlayerHand(seated, interaction)
                return
            }

            const [, action, playerId] = interaction.customId.split(':')
            const player = this.GetPlayer(playerId)
            if (!player) {
                await this.respondEphemeral(interaction, { content: "⚠️ You are not seated at this table." })
                return
            }
            if (this.awaitingPlayerId && player.id !== this.awaitingPlayerId) {
                await this.respondEphemeral(interaction, { content: "❌ It's not your turn." })
                return
            }

            let amount = null
            if (action === "bet" || action === "raise") {
                const modal = new ModalBuilder().setCustomId(`tx_modal:${interaction.id}`).setTitle(`Amount for ${action}`)
                const amountInput = new TextInputBuilder().setCustomId("amount").setLabel("Amount").setStyle(TextInputStyle.Short).setRequired(true)
                modal.addComponents(new ActionRowBuilder().addComponents(amountInput))

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    buildTexasInteractionLog(interaction, "Failed to show Texas modal", { action, playerId, error: error?.message })
                    return
                }

                const submission = await interaction.awaitModalSubmit({ time: config.texas.modalTimeout.default }).catch((error) => {
                    buildTexasInteractionLog(interaction, "Failed to await Texas modal submission", {
                        phase: "bettingModal",
                        action,
                        playerId,
                        error: error?.message
                    })
                    return null
                })

                if (!submission) return

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
    }

    async Action(type, player, params, options = {}) {
        const { isBlind = false, skipAdvance = false } = options
        if (!player || player.status?.removed) return

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
        this.bets.total += amount
        if (player.stack === 0) {
            player.status.allIn = true
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
        await this.updateGameMessage(player, { availableOptions })

        this.timer = setTimeout(() => {
            const fallbackOptions = this.GetAvailableOptions(player)
            if (fallbackOptions.includes("check")) {
                this.Action("check", player).catch((error) => {
                    logger.warn("Failed to auto-check player", {
                        scope: "texasGame",
                        playerId: player?.id,
                        error: error?.message
                    })
                    return null
                })
            } else {
                this.Action("fold", player).catch((error) => {
                    logger.warn("Failed to auto-fold player", {
                        scope: "texasGame",
                        playerId: player?.id,
                        error: error?.message
                    })
                    return null
                })
            }
        }, config.texas.actionTimeout.default)
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
        await this.SendMessage("handEnded")
        await this.NextHand()
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
        await this.SendMessage("handEnded")
        await this.NextHand()
    }

    async Stop(options = {}) {
        if (this.actionCollector) this.actionCollector.stop();
        if (this.timer) clearTimeout(this.timer);
        this.playing = false;
        this.channel.game = null;
        this.awaitingPlayerId = null;
        if (this.client.activeGames) this.client.activeGames.delete(this);

        if (options.reason === "notEnoughPlayers" || options.reason === "canceled") {
            await this.refundPlayers();
        }

        if (options.notify) {
            this.SendMessage("minPlayersDelete");
        }
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
        if (this.players.length < this.getMinimumPlayers()) return this.Stop({ notify: true })
        this.playing = true
        await this.NextHand()
    }
}
