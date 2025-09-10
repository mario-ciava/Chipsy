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

const ACTION_TIMEOUT_MS = 45000

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
                : "Texas Hold'em player"

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
            user
        }
    }

    async AddPlayer(user, options = {}) {
        if (!user || !user.id) return
        const maxSeats = Number.isFinite(this.maxPlayers) && this.maxPlayers > 0 ? this.maxPlayers : Infinity
        if (this.players.length >= maxSeats) {
            await this.SendMessage("maxPlayers", user)
            return
        }
        if (this.GetPlayer(user.id)) return
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
            return
        }
        const player = this.createPlayerSession(user, buyInResult.amount)
        if (!player) return

        // Subtract buy-in from user's bankroll (not from stack, as that's table-only)
        const currentBankroll = bankrollManager.getBankroll(user)
        if (currentBankroll < buyInResult.amount) {
            await this.SendMessage("noMoneyBet", user)
            return
        }
        user.data.money = currentBankroll - buyInResult.amount

        // Save buy-in deduction to database immediately
        await this.dataHandler.updateUserData(user.id, this.dataHandler.resolveDBUser(user))

        this.players.push(player)
        // playerAdded message removed - lobby will handle the update
    }

    async RemovePlayer(player, options = {}) {
        const { skipStop = false, stopOptions = {} } = options
        const playerId = typeof player === "object" ? player?.id : player
        if (!playerId) return false
        const existing = this.GetPlayer(playerId)
        if (!existing) return false

        // Return stack to bankroll before removing player
        if (existing.stack > 0) {
            bankrollManager.syncStackToBankroll(existing)
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing))
        }

        this.players = this.players.filter((p) => p.id !== playerId)

        if (!skipStop && this.players.length < 2 && this.playing) {
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
            .setFooter({ text: `Pot: ${setSeparator(this.bets.pots.reduce((a, b) => a + b.amount, 0) + this.bets.total)}$ | ${ACTION_TIMEOUT_MS / 1000}s left` })

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

    async NextHand() {
        if (!this.playing) return

        this.players.forEach(p => this.AssignRewards(p))
        this.players = this.players.filter(p => p.stack >= this.minBet)
        if (this.players.length < 2) return this.Stop({ reason: "notEnoughPlayers" })

        await this.Reset()
        await this.Shuffle(this.cards)
        this.players = this.Rotate(this.players, 1)

        this.inGamePlayers = [...this.players]
        this.inGamePlayers.forEach(p => {
            p.status = { folded: false, movedone: false, won: { grossValue: 0, netValue: 0, expEarned: 0 } }
            p.bets = { current: 0, total: 0 }
            p.cards = this.PickRandom(this.cards, 2)
            p.user.send({ embeds: [new Discord.EmbedBuilder().setTitle("Your cards").setDescription(p.cards.join(' '))] }).catch(() => logger.warn(`Could not send cards to ${p.tag}`))
        })

        // Blinds
        const sbPlayer = this.inGamePlayers[0]
        const bbPlayer = this.inGamePlayers[1]
        this.Action("bet", sbPlayer, this.minBet / 2, true)
        this.Action("bet", bbPlayer, this.minBet, true)

        this.hands++
        await this.SendMessage("nextHand")
        await sleep(8000)

        if (!this.actionCollector) this.CreateOptions()
        this.NextPlayer(this.inGamePlayers[2] || this.inGamePlayers[0])
    }

    async NextPhase(phase) {
        // Pot logic here

        const phases = ["flop", "turn", "river", "showdown"]
        if (!phases.includes(phase)) return

        if (phase === "showdown") {
            this.inGamePlayers.forEach(p => p.hand = Hand.solve(this.tableCards.concat(p.cards)))
            const winners = Hand.winners(this.inGamePlayers.map(p => p.hand))
            const winnerPlayers = this.inGamePlayers.filter(p => winners.includes(p.hand))
            this.bets.pots.push({ amount: this.bets.total, winners: winnerPlayers })
            await this.SendMessage("handEnded")
            return this.NextHand()
        }

        if (phase === "flop") this.tableCards = this.PickRandom(this.cards, 3)
        else this.tableCards.push(this.PickRandom(this.cards, 1)[0])

        this.inGamePlayers.forEach(p => p.status.movedone = false)
        this.bets.currentMax = 0

        const snapshot = await this.captureTableRender({ title: phase.charAt(0).toUpperCase() + phase.slice(1) })
        const embed = new Discord.EmbedBuilder().setColor(Discord.Colors.Blue).setTitle(phase.toUpperCase()).setImage(`attachment://${snapshot.filename}`)
        await this.channel.send({ embeds: [embed], files: [snapshot.attachment] })

        this.NextPlayer(this.inGamePlayers.find(p => !p.status.folded))
    }

    CreateOptions() {
        this.actionCollector = this.channel.createMessageComponentCollector({ filter: i => i.customId.startsWith("tx_action:") && this.GetPlayer(i.user.id), time: 300000 })
        this.actionCollector.on("collect", async i => {
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
                const submission = await i.awaitModalSubmit({ time: 60000 }).catch(() => null)
                if (!submission) return
                amount = features.inputConverter(submission.fields.getTextInputValue("amount"))
                await submission.deferUpdate()
            }

            this.Action(action, player, amount)
            if(!i.deferred) await i.deferUpdate()
        })
    }

    async Action(type, player, params, isBlind = false) {
        if (!isBlind && !this.GetAvailableOptions(player).includes(type)) return
        clearTimeout(this.timer)

        switch (type) {
            case "fold": player.status.folded = true; break
            case "check": break;
            case "call":
                const callAmount = this.bets.currentMax - player.bets.current
                player.stack -= callAmount; player.bets.current += callAmount; player.bets.total += callAmount; this.bets.total += callAmount
                break
            case "bet":
            case "raise":
                const betAmount = params || this.minBet
                if (player.stack < betAmount) return // Or handle as all-in
                player.stack -= betAmount; player.bets.current += betAmount; player.bets.total += betAmount; this.bets.total += betAmount
                if (player.bets.current > this.bets.currentMax) this.bets.currentMax = player.bets.current
                this.inGamePlayers.forEach(p => { if (p.id !== player.id) p.status.movedone = false })
                break
            case "allin":
                const allInAmount = player.stack
                player.bets.current += allInAmount; player.bets.total += allInAmount; this.bets.total += allInAmount; player.stack = 0
                if (player.bets.current > this.bets.currentMax) this.bets.currentMax = player.bets.current
                this.inGamePlayers.forEach(p => { if (p.id !== player.id) p.status.movedone = false })
                break
        }
        player.status.movedone = true
        this.UpdateInGame()

        if (this.inGamePlayers.length < 2) {
            const winner = this.inGamePlayers[0]
            winner.status.won.grossValue = this.bets.total
            this.AssignRewards(winner)
            await this.SendMessage("handEnded")
            return this.NextHand()
        }

        const next = this.inGamePlayers.find(p => !p.status.movedone)
        if (next) {
            this.NextPlayer(next)
        } else {
            const phase = this.tableCards.length === 0 ? "flop" : this.tableCards.length === 3 ? "turn" : this.tableCards.length === 4 ? "river" : "showdown"
            this.NextPhase(phase)
        }
    }

    async NextPlayer(player) {
        if (!this.playing || !player) return
        this.UpdateInGame()
        if (this.inGamePlayers.length < 2) return this.NextHand()

        await this.updateGameMessage(player)

        this.timer = setTimeout(() => {
            if (this.GetAvailableOptions(player).includes("check")) this.Action("check", player)
            else this.Action("fold", player)
        }, ACTION_TIMEOUT_MS)
    }

    async GetAvailableOptions(player) {
        const options = ["fold"]
        if (player.bets.current === this.bets.currentMax) options.push("check")
        else if (player.stack > this.bets.currentMax - player.bets.current) options.push("call")
        if (player.stack > this.minBet) options.push("bet")
        if (player.stack > this.bets.currentMax - player.bets.current) options.push("raise")
        options.push("allin")
        return options
    }

    UpdateInGame() {
        this.inGamePlayers = this.players.filter(p => !p.status.folded && !p.status.removed)
    }

    AssignRewards(player) {
        if (!player.status) return
        if (player.status.won.grossValue > 0) {
            const netValue = this.GetNetValue(player.status.won.grossValue, player)
            player.stack += netValue
            player.data.money += netValue - player.bets.total
            player.data.hands_won++
        }
        player.data.hands_played++
        this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
    }

    GetNetValue(gross, player) {
        return gross // Simplified for now
    }

    async Reset() {
        this.cards = [...cards]
        this.tableCards = []
        this.bets = { minRaise: this.minBet, currentMax: 0, total: 0, pots: [] }
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
    }

    Stop(options = {}) {
        if (this.actionCollector) this.actionCollector.stop()
        if (this.timer) clearTimeout(this.timer)
        this.playing = false
        this.channel.game = null
        if (this.client.activeGames) this.client.activeGames.delete(this)
        if (options.notify) this.SendMessage("minPlayersDelete")
    }

    async Run() {
        if (this.players.length < 2) return this.Stop({ notify: true })
        this.playing = true
        this.NextHand()
    }
}
