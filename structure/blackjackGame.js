const Discord = require("discord.js")
const features = require("../structure/features.js"),
    delay = (ms) => { return new Promise((res) => { setTimeout(() => { res() }, ms)})},
    Game = require("../structure/game.js"),
    cards = require("../structure/cards.js"),
    setSeparator = require("../util/setSeparator"),
    bankrollManager = require("../util/bankrollManager"),
    logger = require("../util/logger")
module.exports = class BlackJack extends Game {
    constructor(info) {
        super(info)
        this.cards = [...cards, ...cards, ...cards],
        this.betsCollector = null,
        this.dealer = null
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

    async SendMessage(type, player, info) {
        const channel = this.channel
        if (!channel || typeof channel.send !== "function") {
            logger.warn("Unable to send blackjack message: channel unavailable", {
                scope: "blackjackGame",
                type,
                channelId: channel?.id
            })
            return null
        }
        const clientAvatar = this.client?.user?.displayAvatarURL({ extension: "png" }) ?? null
        const sendEmbed = async(embed) => {
            try {
                return await channel.send({ embeds: [embed] })
            } catch (error) {
                logger.error("Failed to send blackjack message", {
                    scope: "blackjackGame",
                    type,
                    channelId: channel?.id,
                    userId: player?.id,
                    error: error.message,
                    stack: error.stack
                })
                return null
            }
        }
        switch(type) {
            case "deckRestored": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Aqua)
                    .setFooter({ text: "Game deck has been shuffled and restored", iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "maxPlayers": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag}, access denied: maximum number of players reached for this game`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "playerAdded": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setFooter({
                        text: `${player.tag} joined this game | Stack: ${setSeparator(player.stack)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "playerRemoved": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setFooter({
                        text: `${player.tag} left this game`,
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
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({ text: message })
                await sendEmbed(embed)
            break }
            case "stand":
            case "hit": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(type == "hit" ? Discord.Colors.Purple : Discord.Colors.LuminousVividPink)
                    .setFooter({
                        text: `${player.tag} ${type == "hit" ? "hit" : "stand"}s`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "double": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Orange)
                    .setFooter({
                        text: `${player.tag} doubles (-${setSeparator(player.bets.initial)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "split": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Aqua)
                    .setFooter({
                        text: `${player.tag} splits hand (-${setSeparator(player.bets.initial)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "insurance": {
                const insuranceValue = Math.max(0, Number(info?.amount ?? player?.bets?.insurance ?? 0))
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Orange)
                    .setFooter({
                        text: `${player.tag} has bought insurance (-${setSeparator(insuranceValue)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "insuranceRefund": {
                const payout = Math.max(0, Number(info?.payout ?? 0))
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Green)
                    .setFooter({
                        text: `${player.tag} has been refunded due to insurance (+${setSeparator(payout)}$)`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "invalidBet": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag}, invalid bet amount provided.`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "betLocked": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag}, you have already placed your bet for this round.`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "dealerHit":
            case "dealerStand": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(type == "dealerHit" ? Discord.Colors.Purple : Discord.Colors.LuminousVividPink)
                    .setFooter({ text: `Dealer ${type == "dealerHit" ? "hit" : "stand"}s`, iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "dealerBusted": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({ text: "Dealer busted!", iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "showDealer": {
                this.dealer.display = await this.CardReplacer(this.dealer.cards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setThumbnail(clientAvatar)
                    .addFields({
                        name: `Dealer's cards`,
                        value: `Dealer will stand on 17 or higher\n\n**Cards:** ${this.dealer.display.join(" ")}\n**Value:** ${this.dealer.value} ${this.dealer.busted ? "[Busted]" : ""} ${this.dealer.BJ ? "[Blackjack]" : ""}`
                    })
                await sendEmbed(embed)
            break }
            case "showStartingCards": {
                for (let player of this.inGamePlayers)
                    player.hands[0].display = await this.CardReplacer(player.hands[0].cards)
                this.dealer.display = await this.CardReplacer(this.dealer.cards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({
                        name: "All cards",
                        value: `${this.inGamePlayers.map((pl) => {
                            return `${pl} - ${pl.hands[0].display.join(" ")} - Bet ${setSeparator(pl.bets.initial)}$`
                        }).join("\n") || "-"}\n\n**Dealer:** ${this.dealer.display[0]} (???)`
                    })
                await sendEmbed(embed)
            break }
            case "showFinalResults": {
                for (let player of this.inGamePlayers)
                    player.hands[0].display = await this.CardReplacer(player.hands[0].cards)
                this.dealer.display = await this.CardReplacer(this.dealer.cards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setThumbnail(this.client.user.displayAvatarURL({ extension: "png" }))
                    .addFields({
                        name: `Final results | Round #${this.hands}`,
                        value: `${this.inGamePlayers.map((pl) => {
                            return pl.hands.map((hand) => {
                                return `${pl} **(hand #${pl.hands.indexOf(hand) + 1}):** ${hand.display.join(" ")} - Value: ${hand.value} ${hand.busted ? "[Busted]" : hand.BJ ? "[BJ]" : ""} - Winning (net value): ${hand.push || hand.busted ? 0 : (this.dealer.busted ? setSeparator(this.GetNetValue(hand.BJ ? (hand.push ? hand.bet : parseInt(hand.bet * 2.5)) : hand.bet * 2, pl)) : (this.dealer.value > hand.value ? 0 : setSeparator(this.GetNetValue(hand.BJ ? (hand.push ? hand.bet : parseInt(hand.bet * 2.5)) : hand.bet * 2, pl))))}$ [+${setSeparator(pl.status.won.expEarned / pl.hands.length)}XP] ${hand.push ? "(Push)" : ""}`
                            }).join("\n") || "-"
                        }).join("\n") || "-"}\n\n**Dealer:** ${this.dealer.display.join(" ")} - Value: ${this.dealer.value} ${this.dealer.busted ? "[Busted]" : this.dealer.BJ ? "[BJ]" : ""}`
                    })
                await sendEmbed(embed)
            break }
            case "displayInfo": {
                this.dealer.display = await this.CardReplacer(this.dealer.cards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Gold)
                    .setThumbnail(player.displayAvatarURL({ extension: "png" }))
                    .addFields({
                        name: `Your cards | ${player.tag}`,
                        value: `${player.hands.map((hand) => {
                            return `**Hand #${player.hands.indexOf(hand) + 1} ${player.hands.indexOf(hand) == player.status.currentHand ? "(current)" : ""}:** ${hand.display.join(" ")} | Value: ${hand.value} ${hand.busted ? "[Busted]" : hand.BJ ? "[BJ]" : ""}`
                        }).join("\n") || "-"}\n\n**Options (hand #${player.status.currentHand + 1}):** ${player.availableOptions.join(" - ")} ${info ? "*standing automatically*" : ""}`
                    })
                    .setFooter({
                        text: `Dealer's cards: ${this.dealer.display[0]} (???) | Total bet: ${setSeparator(player.bets.total)}$ | Insurance: ${player.bets.insurance > 0 ? setSeparator(player.bets.insurance) + "$" : "no"} | 30s left`,
                        iconURL: clientAvatar
                    })
                await sendEmbed(embed)
            break }
            case "noRemaining": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Orange)
                    .setFooter({ text: "No util players left, proceding to next hand", iconURL: clientAvatar })
                await sendEmbed(embed)
            break }
            case "busted": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .addFields({
                        name: "Busted!",
                        value: `Hand #${player.hands.indexOf(info) + 1} - ${info.display.join(" ")} - Value: ${info.value} - Busted`
                    })
                    .setFooter({
                        text: `${player.tag} | Total bet: ${setSeparator(player.bets.total)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "noMoneyBet": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag}, you can not afford to bet this amount of money`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "betsOpened": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Green)
                    .addFields(
                        {
                            name: `Bets opened | Round #${this.hands}`,
                            value: "Players, please place your bets using **bet [amount]**\nIf no amount is supplied, it will automatically be set to the minimum required"
                        },
                        {
                            name: "Available stacks",
                            value: `${this.players.filter((p) => {
                                return !p.newEntry
                            }).map((p) => {
                                return `${p} - Stack: ${setSeparator(p.stack)}$`
                            }).join("\n") || "-"}`
                        }
                    )
                    .setFooter({ text: `You have got 30 seconds | Deck remaining cards: ${this.cards.length}` })
                await sendEmbed(embed)
            break }
            case "bet": {
                let rp = this.players.filter((pl) => {
                    return !pl.newEntry && pl.bets.initial < 1
                }).length
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Aqua)
                    .setFooter({
                        text: `${player.tag} bet ${setSeparator(player.bets.initial)}$ ${rp > 0 ? `| Waiting for ${rp} players` : ""}`.trim(),
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case "betsClosed": {
                const allBetsPlaced = info?.allBetsPlaced === true
                const message = allBetsPlaced
                    ? "All players have placed their bets"
                    : "Time is up"
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .addFields({
                        name: `Bets closed | Round #${this.hands}`,
                        value: message
                    })
                    .setFooter({ text: "Your cards will be shown in a moment" })
                await sendEmbed(embed)
            break }
        }
    }

    async NextHand() {
        if (!this.playing) return
        
        await this.Reset()
        if (this.hands < 1) await this.Shuffle(this.cards)

        if (this.cards.length < 25) {
            this.cards = [...cards, ...cards, ...cards]
            await this.Shuffle(this.cards)
            await this.SendMessage("deckRestored")
            await delay(2000)
        }

        for (let player of this.players) {
            player.stack = bankrollManager.getStack(player)
            if (this.hands > 0 && player.stack < this.minBet) {
                this.RemovePlayer(player)
                continue
            }
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
                    expEarned: 0
                }
            }
            player.bets = {
                initial: 0,
                total: 0,
                insurance: 0
            }
        }

        this.dealer = {
            cards: [],
            value: 0,
            pair: false,
            display: []
        }

        this.hands++

        this.AwaitBets()
    }

    async AwaitBets() {
        this.betsCollector = this.channel.createMessageCollector({
            filter: (m) => !m.author.bot && m.content.toLowerCase().startsWith("bet") && this.GetPlayer(m.author.id),
            time: 30000
        })
        this.SendMessage("betsOpened")
        this.betsCollector.on("collect", async(mess) => {
            if (mess.deletable) mess.delete()
            let player = this.GetPlayer(mess.author.id)
            if (!player || !player.data) return
            if (player.bets && player.bets.initial > 0) {
                await this.SendMessage("betLocked", player)
                return
            }
            const contentParts = mess.content.toLowerCase().trim().split(/\s+/)
            const betArgument = contentParts[1]
            const rawBet = betArgument !== undefined ? features.inputConverter(betArgument) : undefined
            let bet = rawBet
            if (bet === undefined) bet = this.minBet
            if (!Number.isFinite(bet) || bet <= 0) {
                await this.SendMessage("invalidBet", player)
                return
            }
            bet = Math.floor(bet)
            if (bet < this.minBet) {
                await this.SendMessage("invalidBet", player)
                return
            }
            if (!bankrollManager.canAfford(player, bet)) return this.SendMessage("noMoneyBet", player)
            if (!bankrollManager.withdraw(player, bet)) return this.SendMessage("noMoneyBet", player)
            player.bets.initial = bet
            player.bets.total += bet
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
                fromSplitAce: false
            })
            if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
            await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
            await this.SendMessage("bet", player)
            let remaining = this.players.filter((player) => {
                return player.bets ? player.bets.initial < 1 : true == false
            }).length
            if (remaining < 1) this.betsCollector.stop()
        })
        this.betsCollector.on("end", async(coll, reason) => {
            const allBetsPlaced = reason === "stop"
            await this.SendMessage("betsClosed", null, { allBetsPlaced })
            await delay(1000)
            await this.UpdateInGame()
            if (this.inGamePlayers.length < 1 && this.playing) return this.Stop({ reason: "noBetsPlaced" })
            if (!this.collector) await this.CreateOptions()
            this.betsCollector = null
            if (this.inGamePlayers.length > 1) {
                await delay(2000)
                this.SendMessage("showStartingCards")
            }
            this.dealer.cards = await this.PickRandom(this.cards, 2)
            await delay(2000)
            this.NextPlayer()
        })
    }

    async NextPlayer(player, auto) {
        if (!this.playing) return
        await this.UpdateInGame()
        let currentPlayer = player ? player : this.inGamePlayers[0]
        currentPlayer.status.current = true
        currentPlayer.availableOptions = await this.GetAvailableOptions(currentPlayer, currentPlayer.status.currentHand)
        this.timer = setTimeout(() => {
            this.Action("stand", currentPlayer, currentPlayer.status.currentHand)
        }, 30 * 1000)

        await this.UpdateDisplay(currentPlayer.hands)
        if (currentPlayer.hands[currentPlayer.status.currentHand].BJ || auto) {
            clearTimeout(this.timer)
            this.timer = null
            currentPlayer.availableOptions = []
            await delay(2000)
            this.SendMessage("displayInfo", currentPlayer, true)
            await delay(3500)
            return this.Action("stand", currentPlayer, currentPlayer.status.currentHand, true)
        }
        await delay(2000)
        this.SendMessage("displayInfo", currentPlayer)
    }

    async UpdateDisplay(hands) {
        for (let hand of hands) {
            hand.display = await this.CardReplacer(hand.cards)
        }
        return hands
    }

    async CreateOptions() {
        let options = ["stand", "hit", "double", "split", "insurance"]
        this.collector = this.channel.createMessageCollector({
            filter: (m) => !m.author.bot && options.includes(m.content.toLowerCase())
                && this.GetPlayer(m.author.id)
        })
        this.collector.on("collect", (mess) => {
            if (mess.deletable) mess.delete()
            let player = this.GetPlayer(mess.author.id)
            if (!player.status.current) return
            this.Action(mess.content.toLowerCase(), player, player.status.currentHand)
        })
    }

    async ComputeHandsValue(player, dealer) {
        var inspectHand = (hand) => {
            let aces = hand.cards.filter((card) => {
                return card.split("")[0] == "A"
            }).length
            hand.value = 0

            for (let card of hand.cards) {
                let firstCard = hand.cards[0].split("")[0],
                    secondCard = hand.cards[1].split("")[0]

                if (hand.cards.length == 2 && !hand.pair && firstCard == secondCard) hand.pair = true
                if (!hand.pair && hand.cards.length == 2 && aces == 1 && (player ? player.hands.length < 2 : true == true)) {
                    let fig = hand.cards.filter((card) => {
                        return ["K", "Q", "J", "T"].includes(card.split("")[0])
                    }).length
                    if (fig > 0) hand.BJ = true
                }

                let val = parseInt(card.split("")[0])
                if (!isNaN(val)) hand.value += val
                    else if (card.split("")[0] == "A") hand.value += 11
                        else hand.value += 10                
            }
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
        const canAffordBaseBet = bankrollManager.canAfford(player, player.bets?.initial)
        if (hand.cards.length < 3 && canAffordBaseBet) available.push("double")
        if (hand.pair && player.hands.length < 4 && canAffordBaseBet) available.push("split")
        const insuranceBet = Math.floor(player.bets.initial / 2)
        const dealerUpCard = (this.dealer?.cards?.[0] || "").split("")[0]
        if (dealerUpCard == "A" && player.bets.insurance < 1 && hand.cards.length < 3 && insuranceBet > 0 && bankrollManager.canAfford(player, insuranceBet)) available.push("insurance")
        return available
    }

    async Action(type, player, hand, automatic) {
        if (!player.availableOptions.includes(type) && !automatic) return
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        await this.ComputeHandsValue(player)
        switch(type) {
            case `stand`:
                await this.SendMessage("stand", player)
            break
            case `hit`:
                player.hands[hand].cards = player.hands[hand].cards.concat(await this.PickRandom(this.cards, 1))
                await this.ComputeHandsValue(player)
                await this.SendMessage("hit", player)
                if (!player.hands[hand].busted) return this.NextPlayer(player)
            break
            case `double`: {
                const additionalBet = Number.isFinite(player.bets?.initial) ? player.bets.initial : 0
                if (additionalBet < 1 || !bankrollManager.canAfford(player, additionalBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                player.hands[hand].cards = player.hands[hand].cards.concat(await this.PickRandom(this.cards, 1))
                if (!bankrollManager.withdraw(player, additionalBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                player.bets.total += additionalBet
                player.hands[hand].bet += additionalBet
                await this.ComputeHandsValue(player)
                await this.SendMessage("double", player)
                if (!player.hands[hand].busted) return this.NextPlayer(player, true)
            break }
            case `split`: {
                const splitCost = Number.isFinite(player.bets?.initial) ? player.bets.initial : 0
                if (splitCost < 1 || !bankrollManager.canAfford(player, splitCost)) {
                    await this.SendMessage("noMoneyBet", player)
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
                    fromSplitAce: splitAce
                })
                currentHand.cards = await currentHand.cards.concat(await this.PickRandom(this.cards, 1))
                await this.ComputeHandsValue(player)
                if (!bankrollManager.withdraw(player, splitCost)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                player.bets.total += splitCost
                await this.SendMessage("split", player)
                return this.NextPlayer(player)
            }
            case `insurance`: {
                const insuranceBet = Math.floor(player.bets.initial / 2)
                if (insuranceBet < 1 || player.bets.insurance > 0) return this.NextPlayer(player)
                if (!bankrollManager.canAfford(player, insuranceBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                if (!bankrollManager.withdraw(player, insuranceBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                player.bets.insurance += insuranceBet
                player.bets.total += insuranceBet
                player.status.insurance = {
                    wager: insuranceBet,
                    settled: false
                }
                await this.SendMessage("insurance", player, { amount: insuranceBet })
                return this.NextPlayer(player)
            }
            break
        }

        await delay(2000)
        await this.ComputeHandsValue(player)
        await this.UpdateDisplay(player.hands)

        if (player.hands[hand].busted) 
            this.SendMessage("busted", player, player.hands[hand])

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

    async DealerAction() {
        await this.ComputeHandsValue(null, this.dealer)
        await this.UpdateInGame()

        let remainingPlayers = this.inGamePlayers.filter((pl) => {
            return pl.hands.some((hand) => {
                return !hand.busted
            })
        })

        if (remainingPlayers.length < 1) {
            this.SendMessage("noRemaining")
            for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                await this.CheckExp(player.status.won.expEarned, player)
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
            }
            return this.NextHand()
        }

        //if (this.dealer.value > 21) this.dealer.busted = true

        this.SendMessage("showDealer")
        await delay(2000)

        if (this.dealer.value < 17) {
            this.dealer.cards = this.dealer.cards.concat(await this.PickRandom(this.cards, 1))
            await this.ComputeHandsValue(null, this.dealer)
            await this.SendMessage("dealerHit")
            await delay(2000)
            return this.DealerAction()
        }

        if (!this.dealer.busted) await this.SendMessage("dealerStand")
            else this.SendMessage("dealerBusted")
        await delay(2000)

        for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                player.data.hands_played++
            const insuranceWager = player.status.insurance?.wager || 0
            if (this.dealer.BJ && insuranceWager > 0 && !player.status.insurance.settled) {
                const insurancePayout = insuranceWager * 3
                bankrollManager.deposit(player, insurancePayout)
                player.status.insurance.settled = true
                player.status.won.grossValue += insurancePayout
                player.status.won.netValue += (insurancePayout - insuranceWager)
                await this.SendMessage("insuranceRefund", player, { payout: insurancePayout })
                await delay(1000)
            }
            for (let hand of player.hands) {
                let wf = 1
                if (hand.busted) continue
                if (this.dealer.busted || hand.value > this.dealer.value) wf = 2
                if (!this.dealer.busted && hand.value < this.dealer.value) continue
                if (!this.dealer.busted && hand.BJ && hand.value != this.dealer.value) wf = 2.5
                if (!this.dealer.busted && hand.value == this.dealer.value) hand.push = true
                player.status.won.grossValue += (hand.bet * wf)
                let winning = hand.push ? (hand.bet * wf) : this.GetNetValue(hand.bet * wf, player)
                bankrollManager.deposit(player, winning)
                player.status.won.netValue += winning
            }
            if (player.status.won.grossValue > 0) {
                player.data.hands_won++
                player.status.won.expEarned += parseInt((Math.log(player.status.won.grossValue)) * (1.2 + (Math.sqrt(player.status.won.grossValue) * 0.003)) + 10)
            }
            if (player.status.won.grossValue > player.data.biggest_won) player.data.biggest_won = player.status.won.grossValue
            await this.CheckExp(player.status.won.expEarned, player)
            await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
        }

        this.SendMessage("showFinalResults")
        this.UpdateInGame()
        await delay(4500)
        let available = this.players.filter((pl) => {
            return pl.stack > 0
        })
        if (this.playing && available.length < 1) return this.Stop()
        this.NextHand()
    }

    GetNetValue(grossValue, player) {
        return grossValue - parseInt(grossValue * (features.applyUpgrades("with-holding", player.data.withholding_upgrade, 0.0003 * 8, 0.00002 * 2.5)))
    }

    async AddPlayer(user, options = {}) {
        if (!user || !user.id) return
        if (this.players.length >= this.maxPlayers) {
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
        this.players.push(player)
        await this.SendMessage("playerAdded", player)
    }

    async RemovePlayer(player) {
        const playerId = typeof player === "object" ? player?.id : player
        if (!playerId) return
        const existing = this.GetPlayer(playerId)
        if (!existing) return
        const index = this.players.indexOf(existing)
        if (index !== -1) this.players.splice(index, 1)
        await this.SendMessage("playerRemoved", existing)
        if (this.players.length < 1) {
            try {
                await this.Stop()
            } catch (error) {
                logger.error("Failed to stop blackjack after removing last player", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: error.message,
                    stack: error.stack
                })
            }
        }
    }

    UpdateInGame() {
        return this.inGamePlayers = this.players.filter((pl) => {
            return !pl.newEntry && (pl.bets ? pl.bets.initial > 0 : false == true)
        })
    }

    async Reset () {
        for (let player of this.players) {
            await delete player.bets
            await delete player.status
            await delete player.hands
            await delete player.newEntry
        }
    }
    async Stop(options = {}) {
        if (this.__stopping) {
            return null
        }
        this.__stopping = true
        const notify = Object.prototype.hasOwnProperty.call(options || {}, "notify") ? options.notify : true
        const reason = options.reason || "allPlayersLeft"

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
