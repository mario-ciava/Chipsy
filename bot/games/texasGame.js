const Discord = require("discord.js")
const Hand = require('pokersolver').Hand
const features = require("./features.js")
const { sleep } = require("../utils/helpers")
const Game = require("./game.js")
const cards = require("./cards.js")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { renderCardTable, createBlackjackTableState } = require("../rendering/cardTableRenderer")
const bankrollManager = require("../utils/bankrollManager")
const config = require("../../config")

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

        return {
            id: user.id,
            tag,
            username: user.username,
            bot: user.bot,
            data: user.data ?? {},
            client: user.client,
            stack:
                Number.isFinite(stackAmount) && stackAmount > 0
                    ? Math.floor(stackAmount)
                    : 0,
            newEntry: true,
            toString: safeToString,
            displayAvatarURL: safeDisplayAvatar,
            user,
            status: { folded: false, movedone: false, won: { grossValue: 0, netValue: 0, expEarned: 0 } },
            bets: { current: 0, total: 0 },
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

        // Return stack to bankroll before removing player
        if (existing.stack > 0) {
            bankrollManager.syncStackToBankroll(existing);
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing));
        }

        this.players = this.players.filter((p) => p.id !== playerId);

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
                await sendEmbed(new Discord.EmbedBuilder().setColor(Discord.Colors.Red).setFooter({ text: `${player.tag} was removed: no money left.`, iconURL: player.displayAvatarURL({ extension: "png" }) }))
                break
            case 'nextHand':
                await sendEmbed(new Discord.EmbedBuilder().setColor(Discord.Colors.Blue).setFooter({ text: "Next hand starting in 8 seconds..." }))
                break
            case 'handEnded':
                const winnersText = this.bets.pots.map(pot => {
                    return pot.winners.map(p => `${p} wins ${setSeparator(this.GetNetValue(pot.amount / pot.winners.length, p))}$`).join('\n')
                }).join('\n')
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Gold)
                    .setTitle(`Hand #${this.hands} Ended`)
                    .setDescription(this.inGamePlayers.map(p => `${p} - ${p.hand.name}`).join('\n'))
                    .addFields({ name: "Winner(s)", value: winnersText || "No winners" })
                    .setFooter({ text: `Total pot: ${setSeparator(this.bets.pots.reduce((a, b) => a + b.amount, 0))}$` })
                
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
            dealer: { cards: this.tableCards, value: this.bets.pots.reduce((a, b) => a + b.amount, 0) },
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
                attachment: new Discord.AttachmentBuilder(buffer, { name: filename, description: "Texas Hold'em Table" }),
                filename
            }
        } catch (error) {
            logger.error("Failed to render Texas table", { error })
            return null
        }
    }

    async updateGameMessage(player, options = {}) {
        const availableOptions = await this.GetAvailableOptions(player)
        const components = []
        if (!options.hideActions) {
            const row = new Discord.ActionRowBuilder()
            if (availableOptions.includes("fold")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:fold:${player.id}`).setLabel("Fold").setStyle(Discord.ButtonStyle.Danger))
            if (availableOptions.includes("check")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:check:${player.id}`).setLabel("Check").setStyle(Discord.ButtonStyle.Secondary))
            if (availableOptions.includes("call")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:call:${player.id}`).setLabel(`Call (${setSeparator(this.bets.currentMax - player.bets.current)})`).setStyle(Discord.ButtonStyle.Primary))
            if (availableOptions.includes("bet")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:bet:${player.id}`).setLabel(`Bet (${setSeparator(this.minBet)})`).setStyle(Discord.ButtonStyle.Success))
            if (availableOptions.includes("raise")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:raise:${player.id}`).setLabel(`Raise (min ${setSeparator(this.bets.currentMax + this.bets.minRaise)})`).setStyle(Discord.ButtonStyle.Success))
            if (availableOptions.includes("allin")) row.addComponents(new Discord.ButtonBuilder().setCustomId(`tx_action:allin:${player.id}`).setLabel(`All-in (${setSeparator(player.stack)})`).setStyle(Discord.ButtonStyle.Success))
            if (row.components.length > 0) components.push(row)
        }

        const snapshot = await this.captureTableRender({ title: `${player.tag}'s turn`, focusPlayerId: player.id })
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Blue)
            .setTitle(`Texas Hold'em - Round #${this.hands}`)
            .setDescription(`It's ${player}'s turn to act.`)
            .setFooter({
                text: `Pot: ${setSeparator(this.bets.pots.reduce((a, b) => a + b.amount, 0) + this.bets.total)}$ | ${config.texas.actionTimeout.default / 1000}s left`
            })

        if (this.players.length > 0) {
            const infoRow = new Discord.ActionRowBuilder().addComponents(
                new Discord.ButtonBuilder()
                    .setCustomId("tx_hand:view")
                    .setLabel("View Cards")
                    .setStyle(Discord.ButtonStyle.Secondary)
                    .setEmoji("🂠")
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

        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.DarkBlue)
            .setTitle("Your hole cards")
            .setDescription(cards)
            .setFooter({ text: `Stack: ${setSeparator(player.stack)}$` })

        await this.respondEphemeral(interaction, { embeds: [embed] })
    }

    async respondEphemeral(interaction, payload = {}) {
        if (!interaction || typeof interaction.reply !== "function") return null
        const response = {
            flags: Discord.MessageFlags.Ephemeral,
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
        await this.Reset();
        this.Shuffle(this.cards);
        this.players = await this.Rotate(this.players, 1);
        this.inGamePlayers = [...this.players];

        for (const p of this.inGamePlayers) {
            p.status = { folded: false, movedone: false, won: { grossValue: 0, netValue: 0, expEarned: 0 } };
            p.bets = { current: 0, total: 0 };
            p.cards = await this.PickRandom(this.cards, 2);
        };

        // Blinds
        const sbPlayer = this.inGamePlayers[0]
        const bbPlayer = this.inGamePlayers[1]
        const tableMinBet = this.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        await this.Action("bet", sbPlayer, smallBlind, true)
        await this.Action("bet", bbPlayer, tableMinBet, true)

        this.hands++;
        await this.SendMessage("nextHand");
        await sleep(config.texas.nextHandDelay.default);

        if (!this.actionCollector) this.CreateOptions();
        this.NextPlayer(this.inGamePlayers[2] || this.inGamePlayers[0]);
    }

    async NextHand() {
        if (!this.playing) return;

        await Promise.all(this.players.map(player => this.AssignRewards(player)))
        const tableMinBet = this.getTableMinBet()
        this.players = this.players.filter(p => p.stack >= tableMinBet)
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
    }

    async NextPhase(phase) {
        const phases = ["flop", "turn", "river", "showdown"]
        if (!phases.includes(phase)) return

        if (phase === "showdown") {
            const contenders = this.inGamePlayers.filter(p => !p.status.folded)
            if (contenders.length === 0) {
                await this.SendMessage("handEnded")
                return this.NextHand()
            }

            contenders.forEach(p => {
                p.hand = Hand.solve(this.tableCards.concat(p.cards))
            })

            const winners = Hand.winners(contenders.map(p => p.hand))
            const winnerPlayers = contenders.filter(p => winners.includes(p.hand))
            const totalPot = this.bets.total
            const baseShare = winnerPlayers.length > 0 ? Math.floor(totalPot / winnerPlayers.length) : 0
            let remainder = totalPot - baseShare * winnerPlayers.length

            winnerPlayers.forEach((player) => {
                const payout = baseShare + (remainder-- > 0 ? 1 : 0)
                if (!player.status.won) {
                    player.status.won = { grossValue: 0, netValue: 0, expEarned: 0 }
                }
                player.status.won.grossValue += payout
            })

            this.bets.pots = [{
                amount: totalPot,
                winners: winnerPlayers
            }]

            await this.SendMessage("handEnded")
            return this.NextHand()
        }

        if (phase === "flop") {
            this.tableCards = await this.PickRandom(this.cards, 3)
        } else {
            const [card] = await this.PickRandom(this.cards, 1)
            if (card) this.tableCards.push(card)
        }

        this.inGamePlayers.forEach(p => p.status.movedone = false)
        this.resetBettingRound()

        const snapshot = await this.captureTableRender({ title: phase.charAt(0).toUpperCase() + phase.slice(1) })
        if (snapshot) {
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Blue)
                .setTitle(phase.toUpperCase())
                .setImage(`attachment://${snapshot.filename}`)
            await this.channel.send({ embeds: [embed], files: [snapshot.attachment] })
        }

        const nextPlayer = this.inGamePlayers.find(p => !p.status.folded)
        if (nextPlayer) {
            this.NextPlayer(nextPlayer)
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
        this.actionCollector.on("collect", async i => {
            if (i.customId === "tx_hand:view") {
                const seated = this.GetPlayer(i.user.id)
                if (!seated) {
                    await this.respondEphemeral(i, { content: "⚠️ You are not seated at this table." })
                    return
                }
                await this.showPlayerHand(seated, i)
                return
            }

            const [, action, playerId] = i.customId.split(':')
            const player = this.GetPlayer(playerId)
            if (!player || player.id !== this.inGamePlayers.find(p => !p.status.movedone)?.id) {
                return i.reply({ content: "It's not your turn.", ephemeral: true })
            }

            let amount = null
            if (action === 'bet' || action === 'raise') {
                const modal = new Discord.ModalBuilder().setCustomId(`tx_modal:${i.id}`).setTitle(`Amount for ${action}`)
                const amountInput = new Discord.TextInputBuilder().setCustomId("amount").setLabel("Amount").setStyle(Discord.TextInputStyle.Short).setRequired(true)
                modal.addComponents(new Discord.ActionRowBuilder().addComponents(amountInput))
                await i.showModal(modal)
                const submission = await i.awaitModalSubmit({ time: config.texas.modalTimeout.default }).catch(() => null)
                if (!submission) return
                amount = features.inputConverter(submission.fields.getTextInputValue("amount"))
                await submission.deferUpdate()
            }

            await this.Action(action, player, amount)
            if(!i.deferred) await i.deferUpdate()
        })
    }

    async Action(type, player, params, isBlind = false) {
        if (!player) return
        if (!isBlind && !this.GetAvailableOptions(player).includes(type)) return
        clearTimeout(this.timer)

        const tableMinBet = this.getTableMinBet()

        switch (type) {
            case "fold":
                player.status.folded = true
            break
            case "check":
                // Nothing to do
            break
            case "call": {
                const callAmount = Math.max(0, this.bets.currentMax - player.bets.current)
                if (callAmount <= 0) break
                if (player.stack <= callAmount) {
                    const allInAmount = player.stack
                    player.bets.current += allInAmount
                    player.bets.total += allInAmount
                    this.bets.total += allInAmount
                    player.stack = 0
                    if (player.bets.current > this.bets.currentMax) this.bets.currentMax = player.bets.current
                    this.inGamePlayers.forEach(p => { if (p.id !== player.id) p.status.movedone = false })
                } else {
                    player.stack -= callAmount
                    player.bets.current += callAmount
                    player.bets.total += callAmount
                    this.bets.total += callAmount
                }
            }
            break
            case "bet":
            case "raise": {
                const requested = Number.isFinite(params) && params > 0 ? Math.floor(params) : tableMinBet
                const betAmount = isBlind ? requested : Math.max(requested, tableMinBet)
                if (player.stack <= betAmount) {
                    const allInAmount = player.stack
                    player.bets.current += allInAmount
                    player.bets.total += allInAmount
                    this.bets.total += allInAmount
                    player.stack = 0
                } else {
                    player.stack -= betAmount
                    player.bets.current += betAmount
                    player.bets.total += betAmount
                    this.bets.total += betAmount
                }
                if (player.bets.current > this.bets.currentMax) {
                    this.bets.currentMax = player.bets.current
                    this.inGamePlayers.forEach(p => { if (p.id !== player.id) p.status.movedone = false })
                }
            }
            break
            case "allin": {
                const allInAmount = player.stack
                if (allInAmount <= 0) break
                player.bets.current += allInAmount
                player.bets.total += allInAmount
                this.bets.total += allInAmount
                player.stack = 0
                if (player.bets.current > this.bets.currentMax) {
                    this.bets.currentMax = player.bets.current
                    this.inGamePlayers.forEach(p => { if (p.id !== player.id) p.status.movedone = false })
                }
            }
            break
            default:
                return
        }

        player.status.movedone = true
        this.UpdateInGame()

        if (this.inGamePlayers.length < this.getMinimumPlayers()) {
            const winner = this.inGamePlayers[0]
            if (winner) {
                if (!winner.status.won) {
                    winner.status.won = { grossValue: 0, netValue: 0, expEarned: 0 }
                }
                winner.status.won.grossValue += this.bets.total
                this.bets.pots = [{
                    amount: this.bets.total,
                    winners: [winner]
                }]
            }
            await this.SendMessage("handEnded")
            return this.NextHand()
        }

        const next = this.inGamePlayers.find(p => !p.status.movedone)
        if (next) {
            await this.NextPlayer(next)
        } else {
            const phase = this.tableCards.length === 0
                ? "flop"
                : this.tableCards.length === 3
                ? "turn"
                : this.tableCards.length === 4
                ? "river"
                : "showdown"
            await this.NextPhase(phase)
        }
    }

    async NextPlayer(player) {
        if (!this.playing || !player) return
        this.UpdateInGame()
        if (this.inGamePlayers.length < this.getMinimumPlayers()) return this.NextHand()

        await this.updateGameMessage(player)

        this.timer = setTimeout(() => {
            if (this.GetAvailableOptions(player).includes("check")) this.Action("check", player)
            else this.Action("fold", player)
        }, config.texas.actionTimeout.default)
    }

    async GetAvailableOptions(player) {
        const options = ["fold"]
        if (player.bets.current === this.bets.currentMax) options.push("check")
        else if (player.stack > this.bets.currentMax - player.bets.current) options.push("call")
        if (player.stack > this.getTableMinBet()) options.push("bet")
        if (player.stack > this.bets.currentMax - player.bets.current) options.push("raise")
        options.push("allin")
        return options
    }

    UpdateInGame() {
        this.inGamePlayers = this.players.filter(p => !p.status.folded && !p.status.removed)
    }

    async AssignRewards(player) {
        if (!player || !player.status) return
        if (player.status.won && player.status.won.grossValue > 0) {
            const netValue = this.GetNetValue(player.status.won.grossValue, player)
            player.stack += netValue
            player.data.money += netValue - player.bets.total
            player.data.hands_won++
            player.status.won.grossValue = 0
        }
        player.data.hands_played++
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
    }

    async Stop(options = {}) {
        if (this.actionCollector) this.actionCollector.stop();
        if (this.timer) clearTimeout(this.timer);
        this.playing = false;
        this.channel.game = null;
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
