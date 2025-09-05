const Discord = require("discord.js")
const Hand = require('pokersolver').Hand
const features = require("./features.js")
const { delay } = require("../utils/helpers")
const Game = require("./game.js")
const cards = require("./cards.js")
const setSeparator = require("../utils/setSeparator")
module.exports = class Texas extends Game {
    constructor(info) {
        super(info)
        this.bets = {
            minRaise: info.minBet,
            currentMax: 0,
            total: 0,
            pots: []
        }
    }
    //['UTG-PAOLO', 'MARIO', 'D-LUCA', 'SB-MARCO', 'BB-FABIO']
    //['UTG-MARIO', 'LUCA', 'D-MARCO', 'SB-FABIO', 'BB-PAOLO']
    //['UTG-LUCA', 'MARCO', 'D-FABIO', 'SB-PAOLO', 'BB-MARIO']


    //['UTG-FABIO', 'D-PAOLO', 'SB-MARIO', 'BB-LUCA'] - Without marco
    //['UTG-MARCO', 'D-FABIO', 'SB-MARIO', 'BB-LUCA'] - Without paolo

    async SendMessage(type, player, info) {
        let cards = null
        const channel = this.channel
        const sendEmbed = async(embed) => channel.send({ embeds: [embed] })
        switch(type) {
            case `maxPlayers`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag}, access denied: maximum number of players reached for this game`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `minPlayersPause`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Orange)
                    .setFooter({ text: `Game paused: minimum number of players not reached | This game will be deleted in 45 seconds` })
                await sendEmbed(embed)
            break }
            case `minPlayersDelete`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({ text: `Game deleted: minimum number of players not reached` })
                await sendEmbed(embed)
            break }
            case `gameResumed`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Green)
                    .setFooter({ text: `This game has been resumed, please wait for the next hand!` })
                await sendEmbed(embed)
            break }
            case `playerAdded`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setFooter({
                        text: `${player.tag} joined this game | Stack: ${setSeparator(player.stack)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `playerRemoved`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setFooter({
                        text: `${player.tag} left this game`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `noMoney`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag} has been removed from this game: no money left`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `displayInfo`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({
                        name: `Player's game panel`,
                        value: `**Bet on this round:** ${setSeparator(player.bets.current)}$\n**Available options:**\n\n- fold${player.availableOptions.includes("check") ? `\n- check` : ``}${player.availableOptions.includes("call") ? `\n- call (${setSeparator(this.bets.currentMax - player.bets.current)}$)` : ``}${player.availableOptions.includes("bet") ? `\n- bet (min: ${setSeparator(this.minBet)}$)` : ``}${player.availableOptions.includes("raise") ? `\n- raise (min: ${ setSeparator(Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
                            return pl.id != player.id
                        }).map((pl) => {
                            return pl.stack + pl.bets.current
                        })) >= this.bets.currentMax + this.bets.minRaise ? this.bets.currentMax + this.bets.minRaise : info)}$)` : ``}${player.availableOptions.includes("allin") ? `\n- allin (${setSeparator(player.stack)}$)` : ``}`
                    })
                    .setFooter({
                        text: `${player.tag} | You have got 40 seconds to choose | Available stack: ${setSeparator(player.stack)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                    .setThumbnail(player.displayAvatarURL({ extension: "png" }))
                const message = await sendEmbed(embed)
                player.infomess = message
            break }
            case `displayPlayers`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({
                        name: "Players' info",
                        value: `Big Blind: ${info.bigblind} (${setSeparator(info.bigblind.bets.current)}$)\nSmall Blind: ${info.smallblind} (${setSeparator(info.smallblind.bets.current)}$)`
                    })
                    .setFooter({
                        text: `New Players: ${info.newentries.map((pl) => {
                            return `${pl.tag} (${setSeparator(pl.bets.current)}$)`
                        }).join("\n") || `none`}`
                    })
                await sendEmbed(embed)
            break }
            case `nextHand`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setFooter({ text: "Next hand starting in 8 seconds" })
                await sendEmbed(embed)
            break }
            case `check`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Purple)
                    .setFooter({ text: `${player.tag} checked`, iconURL: player.displayAvatarURL({ extension: "png" }) })
                await sendEmbed(embed)
            break }
            case `bet`:
            case `call`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Aqua)
                    .setFooter({
                        text: `${player.tag} ${type == "bet" ? `bet` : `called`} ${setSeparator(info)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `raise`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Orange)
                    .setFooter({
                        text: `${player.tag} raised ${setSeparator(info)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `allin`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.LuminousVividPink)
                    .setFooter({
                        text: `${player.tag} went all-in with ${setSeparator(info)}$`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `fold`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setFooter({
                        text: `${player.tag} folded`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `nextPhase`: {
                cards = await this.CardReplacer(this.tableCards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({ name: `Phase: ${info}`, value: `${cards.join(" ")}` })
                    .setFooter({ text: `Players in game: ${this.inGamePlayers.length} | Pot: ${setSeparator(this.bets.pots.reduce((a, b) => { return a + b.amount }, 0))}$` })
                await sendEmbed(embed)
            break }
            case `sendCards`: {
                cards = await this.CardReplacer(player.cards)
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .addFields({ name: "Your cards", value: `${cards.join(" ")}` })
                    .setFooter({ text: "Do not tell anyone anything while playing!", iconURL: player.displayAvatarURL({ extension: "png" }) })
                await player.send({ embeds: [embed] })
            break }
            case `handValue`: {
                const color = player.hand.rank < 2 ? Discord.Colors.Red : player.hand.rank < 5 ? Discord.Colors.Orange : Discord.Colors.Green
                const embed = new Discord.EmbedBuilder()
                    .setColor(color)
                    .addFields({ name: `Your hand`, value: `Ranking: ${player.hand.rank}/10\nFinal hand value: ${player.hand.descr}` })
                await player.send({ embeds: [embed] })
            break }
            case `wonBeforeEnd`: {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Green)
                    .setFooter({
                        text: `${player.tag} won a pot of ${setSeparator(player.status.won.netValue)}$ (Gross value - ${setSeparator(player.status.won.grossValue)}$) - [+${setSeparator(player.status.won.expEarned)}XP]`,
                        iconURL: player.displayAvatarURL({ extension: "png" })
                    })
                await sendEmbed(embed)
            break }
            case `handEnded`: {
                for (let p of this.inGamePlayers) {
                    p.cards = await this.CardReplacer(p.cards)
                }
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Gold)
                    .addFields(
                        {
                            name: `Hand #${this.hands} ended | Showdown`,
                            value: `${this.inGamePlayers.map((pl) => {
                                return `${pl} - ${pl.cards.join(" ")} - [Rank: ${pl.hand.rank}/10] - ${pl.hand.name}`
                            }).join("\n")}`
                        },
                        {
                            name: "Winner(s)",
                            value: `${this.bets.pots.map((pot) => {
                                return `${pot.winners.map((pl) => {
                                    return `${pl} - ${setSeparator(this.GetNetValue(pot.amount / pot.winners.length, pl))}$ (Gross value - ${setSeparator(pot.amount / pot.winners.length)}$) [+${setSeparator(pl.status.won.expEarned)}XP]`
                                }).join("\n") || "-"}`
                            }).join("\n") || "-"}`
                        }
                    )
                    .setFooter({ text: `Total pot(s) value: ${setSeparator(this.bets.pots.reduce((a, b) => { return a + b.amount }, 0))}$` })
                await sendEmbed(embed)
            break }
        }
    }

    GetNetValue(grossValue, player) {
        return grossValue - parseInt(grossValue * (features.applyUpgrades("with-holding", player.data.withholding_upgrade)))
    }

    async ComputeRewards(players, uniqueWinner) {
        if (uniqueWinner)
            uniqueWinner.status.won.netValue += this.GetNetValue(uniqueWinner.status.won.grossValue, uniqueWinner)
        for (let player of players) {
            player.status.won.expEarned += await parseInt((player.data.level/3) * 2) + 30
            if (player.status.won.grossValue > 0)
                player.status.won.expEarned += await parseInt((Math.log(player.status.won.grossValue)) * (1.2 + (Math.sqrt(player.status.won.grossValue) * 0.003)) + 12)
        }
    }

    async AssignRewards(player) {
        if (!player.status) return
        if (player.status.won.grossValue > player.data.biggest_won) player.data.biggest_won = player.status.won.grossValue
        //player.data.money = player.stack
        if (this.hands > 0) player.data.hands_played++
        player.data.money -= player.bets.total
        if (player.status.won.grossValue > 0) {
            player.data.money += player.status.won.netValue
            player.stack += player.status.won.netValue
            player.data.hands_won++
        }
        await this.CheckExp(player.status.won.expEarned, player)
        await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
    }

    async NextHand() {
        if (!this.playing) return
        for (let pl of this.players) 
            pl.newEntry = false

        for (let queuedPlayer of this.queue) {
            queuedPlayer.newEntry = true
            if (queuedPlayer.status && queuedPlayer.status.removed) queuedPlayer.status.removed = false
            await this.players.push(queuedPlayer)
        }
        await this.Reset()
        await this.Shuffle(this.cards)

        if (this.hands > 0) this.players = await this.Rotate(this.players, 1)

        var toRemoveList = []
        for (let pl of this.players) {
            pl.data.last_played = new Date
            if (this.hands > 0 && !pl.newEntry) await this.AssignRewards(pl)
                else if (pl.status) pl.status = null

            if ((pl.status && pl.status.removed) || pl.stack < 1) {
                await toRemoveList.push(pl)
            }

            if (!this.players[this.players.indexOf(pl) + 1]) {
                for (let removedPL of toRemoveList) {
                    if (removedPL.stack < 1) await this.SendMessage("noMoney", removedPL)
                    await this.RemovePlayer(removedPL, true)
                }
                toRemoveList = []
            }

            if (this.players.length - toRemoveList.length < 2 || toRemoveList.includes(pl)) continue

            await this.Reset(pl)
            pl.status = {
                removed: false,
                folded: false,
                current: false,
                movedone: false,
                won: {
                    grossValue: 0,
                    netValue: 0,
                    expEarned: 0
                }
            }
            pl.bets = {
                current: 0,
                total: 0
            }

            pl.cards = await this.PickRandom(this.cards, 2)
            this.SendMessage("sendCards", pl)

            if (this.players[this.players.indexOf(pl) + 1]) continue

            let fullBetPlayers = this.players.filter((player) => {
                return player.newEntry || this.players.indexOf(player) == this.players.length - 1
            })

            for (let fbPlayer of fullBetPlayers) {
                if (fbPlayer.stack - this.minBet >= 0) fbPlayer.bets.current = this.minBet
                    else fbPlayer.bets.current = fbPlayer.stack
                fbPlayer.stack -= fbPlayer.bets.current
                fbPlayer.bets.total += fbPlayer.bets.current
                this.bets.total += fbPlayer.bets.current
                if (fbPlayer.bets.current > this.bets.currentMax) this.bets.currentMax = fbPlayer.bets.current
            }

            let SB = this.players[this.players.length - 2]
            if (SB.bets.current < 1) {
                if (SB.stack - (Math.floor(this.minBet / 2)) >= 0) SB.bets.current = Math.floor(this.minBet / 2)
                    else SB.bets.current = SB.stack
                SB.stack -= SB.bets.current
                SB.bets.total += SB.bets.current
                this.bets.total += SB.bets.current
                if (SB.bets.current > this.bets.currentMax) this.bets.currentMax = SB.bets.current
            }
        }

        if (this.players.length > 1) this.SendMessage("nextHand")
            else return this.Pause()

        await delay(8000)

        if (!this.playing) return

        this.hands++
        this.SendMessage("displayPlayers", null, {
            bigblind: this.players[this.players.length - 1],
            smallblind: this.players[this.players.length - 2],
            newentries: this.players.filter((pl) => {
                return pl.newEntry
            })
        })

        if (!this.collector) this.CreateOptions()
        this.NextPlayer(this.players[0], true)
    }

    async NextPhase(phase, addedPots) {
        let phases = ["flop", "turn", "river", "showdown"],
            winners = []

        if (!phases.includes(phase) || !this.playing) return

        let pot = {
            amount: this.bets.total,
            includedPlayers: await this.inGamePlayers.filter((pl) => {
                return (pl.stack > 0 && pl.bets.current > 0) || pl.bets.current >= this.bets.currentMax
            }),
            winners: []
        }

        if (pot.amount > 0 && pot.includedPlayers.length > 0) {
            if (this.bets.pots.length < 1) await this.bets.pots.push(pot)
            else if (this.bets.pots.length > 1) {
                if (addedPots) this.bets.pots.push(pot)
                    else this.bets.pots[this.bets.pots.length - 1].amount += this.bets.total
            } else {
                if (addedPots) this.bets.pots.push(pot)
                    else this.bets.pots[0].amount += this.bets.total
            }
        }

        this.bets.total = 0


        switch(phase) {
            case "flop":
                this.cards.splice(Math.floor(Math.random()*this.cards.length), 1)
                this.tableCards = await this.PickRandom(this.cards, 3)
            break

            case "turn":
            case "river":
                this.cards.splice(Math.floor(Math.random()*this.cards.length), 1)
                this.tableCards = await this.tableCards.concat(await this.PickRandom(this.cards, 1))
                if (phase != "river") break
                this.inGamePlayers.forEach((player) => {
                    player.hand = Hand.solve(this.tableCards.concat(player.cards))
                    this.SendMessage("handValue", player)
                })
            break

            case "showdown":
                await this.MergePots()
                for (let pot of this.bets.pots) {
                    pot.winners = await this.ReturnWinners(pot)
                    winners = await winners.concat(pot.winners)
                }
                await this.ComputeRewards(this.players)
                await this.SendMessage("handEnded", null)
            break
        }
        if (phase == "showdown") {
            await delay(2000)
            return this.NextHand()
        }

        this.bets.minRaise = this.minBet
        this.bets.currentMax = 0

        for (let player of this.inGamePlayers) {
            player.bets.current = 0
            if (player.stack > 0) player.status.movedone = false
        }

        this.SendMessage("nextPhase", null, phase)
        await delay(3500)

        let avPlayers = this.inGamePlayers.filter((pl) => {
            return pl.stack > 0
        })

        if (avPlayers.length > 1) this.NextPlayer(avPlayers[0], true)
            else this.NextPhase(phases[phases.indexOf(phase) + 1])
    }

    async MergePots() {
        var CheckIdentical = (arr1, arr2) => {
                if (arr1.length != arr2.length) return false
                for (let i = 0; i < arr1.length - 1; i++) {
                    if (arr1.sort()[i] != arr2.sort()[i])
                        return false
                }
                return true
            },
            result = [],
            maxIndex = this.bets.pots.length,
            toRemove = []

        for (let Xpot of this.bets.pots) {
            if (this.bets.pots.indexOf(Xpot) == maxIndex) break

            let compare = Xpot.includedPlayers.map((player) => {
                return player.tag
            })

            for (let Ypot of this.bets.pots) {
                if (CheckIdentical(compare, Ypot.includedPlayers.map((pl) => {
                        return pl.tag
                    })) && !toRemove.includes(Ypot)) {
                    if (!result.includes(Ypot)) result.push(Ypot)
                }
            }

            if (result.length > 1) {
                toRemove = toRemove.concat(result)
                this.bets.pots.push({
                    amount: result.reduce((a, b) => {
                        return a + b.amount
                    }, 0),
                    includedPlayers: result[0].includedPlayers,
                    winners: []
                })
            }
            result = []

            if (this.bets.pots.indexOf(Xpot) == maxIndex - 1) {
                for (let rem of toRemove) {
                    this.bets.pots.splice(this.bets.pots.indexOf(rem), 1)
                }
            }
        }
    }

    async ReturnWinners(pot) {
        let toCompare = []
        for (let player of pot.includedPlayers) {
            await toCompare.push(player.hand)
        }
        let wHands = await Hand.winners(toCompare)
        var winners = await pot.includedPlayers.filter((player) => {
            return wHands.includes(player.hand)
        })
        for (let winner of winners) {
            winner.status.won.netValue += this.GetNetValue(pot.amount / winners.length, winner)
            winner.status.won.grossValue += parseInt(pot.amount / winners.length)
        }
        return winners
    }

    CreateOptions() {
        let options = ["check", "call", "bet", "raise", "fold", "allin"]
        this.collector = this.channel.createMessageCollector({
            filter: (m) => !m.author.bot && options.includes(m.content.toLowerCase().split(" ")[0])
                && this.GetPlayer(m.author.id)
        })
        this.collector.on("collect", (mess) => {
            if (mess.deletable) mess.delete()
            let pl = this.GetPlayer(mess.author.id)
            if (pl.status.folded || pl.status.removed || !pl.status.current || pl.status.movedone) return
            this.Action(mess.content.toLowerCase().split(" ")[0], pl, features.inputConverter(mess.content.split(" ")[1]))
        })
    }

    async GetAvailableOptions(player) {
        var available = ["fold"]
        let maxLimit = await Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
            return pl.id != player.id
        }).map((pl) => {
            return pl.stack + pl.bets.current
        })),
            avPlayers = await this.inGamePlayers.filter((pl) => {
                return pl.id != player.id && pl.stack > 0
            })
        if (this.bets.currentMax == player.bets.current) {
            await available.push("check")
            if (avPlayers.length < 1) return available

            if (player.stack + player.bets.current > this.minBet && player.bets.current < 1) await available.push("bet")
                else if (player.stack + player.bets.current > this.bets.minRaise && player.bets.current > 0) await available.push("raise")
            if (maxLimit >= player.stack + player.bets.current) await available.push("allin")

        } else if (this.bets.currentMax > player.bets.current) {
            if (player.stack + player.bets.current > this.bets.currentMax) {
                    await available.push("call")
                    if (!avPlayers.some((pl) => {
                        return pl.stack + pl.bets.current > this.bets.currentMax
                    })) return available
                    if (avPlayers.some((pl) => {
                        return pl.stack + pl.bets.current >= this.bets.currentMax + this.bets.minRaise
                    })) await available.push("raise")
                    if (maxLimit >= player.stack + player.bets.current) await available.push("allin")
            } else if (maxLimit >= player.stack + player.bets.current && (avPlayers.length > 0 || player.stack + player.bets.current <= this.bets.currentMax)) await available.push("allin")
        }
        return available
    }

    UpdateInGame() {
        return this.inGamePlayers = this.players.filter((pl) => {
            return !pl.status.folded && !pl.status.removed
        })
    }

    async Action(type, player, params, removed) {
        if (!player.availableOptions.includes(type) || (params && isNaN(params))) return
        let maxLimit = null,
            currentPlayerIndex = this.inGamePlayers.indexOf(player)
        switch(type) {
            case "check":
                await this.SendMessage(type, player)
            break
            case "call":
                await this.SendMessage(type, player, (this.bets.currentMax - player.bets.current))
                player.stack -= (this.bets.currentMax - player.bets.current)
                player.bets.total += (this.bets.currentMax - player.bets.current)
                this.bets.total += (this.bets.currentMax - player.bets.current)
                player.bets.current = this.bets.currentMax
            break
            case "bet":
                if (!params) params = this.minBet
                if (params < this.minBet || params >= player.stack) return
                maxLimit = Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
                    return pl.id != player.id
                }).map((pl) => {
                    return pl.stack
                }))
                if (params > maxLimit) params = maxLimit
                this.bets.minRaise = params
                player.stack -= params
                player.bets.total += params
                this.bets.currentMax = params
                this.bets.total = params
                player.bets.current = params
                for (let pl of this.inGamePlayers) {
                    if (pl.stack > 0) pl.status.movedone = false
                }
                await this.SendMessage(type, player, params)
            break
            case "raise":
                if (!params) params = this.bets.currentMax + this.bets.minRaise
                if (params - this.bets.currentMax < this.bets.minRaise || player.stack - (params - player.bets.current) < 1) return
                maxLimit = Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
                    return pl.id != player.id
                }).map((pl) => {
                    return pl.stack + player.bets.current
                }))
                if (params > maxLimit) params = maxLimit
                this.bets.minRaise = params - this.bets.currentMax
                for (let pl of this.inGamePlayers) {
                    if (pl.stack > 0) pl.status.movedone = false
                }
                await this.SendMessage(type, player, (params - player.bets.current))
                player.stack -= (params - player.bets.current)
                player.bets.total += (params - player.bets.current)
                this.bets.currentMax = params
                this.bets.total += (params - player.bets.current)
                player.bets.current += (params - player.bets.current)
            break
            case "fold":
                player.status.folded = true
                if (player.bets.current < this.bets.currentMax) {
                    player.bets.total += player.bets.current
                    this.bets.total += player.bets.current
                }
                let includedPots = this.bets.pots.filter((pot) => {
                    return pot.includedPlayers.find((p) => {
                        return p.id == player.id
                    })
                })
                for (let pot of includedPots) {
                    let playerInPot = pot.includedPlayers.find((p) => {
                        return p.id == player.id
                    })
                    pot.includedPlayers.splice(pot.includedPlayers.indexOf(playerInPot), 1)
                }
                player.bets.current = 0
                await this.SendMessage(type, player)
            break
            case "allin": //allin with 234
                //allin 309
                this.extra = (player.stack + player.bets.current) - this.bets.currentMax
                if (this.extra >= this.bets.minRaise) this.bets.minRaise = this.extra
                if (player.stack + player.bets.current > this.bets.currentMax) this.bets.currentMax = player.stack + player.bets.current
                maxLimit = Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
                    return pl.id != player.id
                }).map((pl) => {
                    return pl.stack + player.bets.current
                }))
                player.bets.total += player.stack
                player.bets.current += player.stack
                for (let pl of this.inGamePlayers) {
                    if (pl.stack > 0 && pl.bets.current < player.bets.current) pl.status.movedone = false
                }
                this.bets.total += player.stack
                await this.SendMessage(type, player, player.bets.current)
                player.stack = 0
            break
        }

        if (player.infomess && player.infomess.deletable) player.infomess.delete()
        player.infomess = null
        player.status.current = false
        player.status.movedone = true
        if (player.data.biggest_bet < player.bets.current) player.data.biggest_bet = player.bets.current

        clearTimeout(this.timer)
        this.timer = null
        await this.UpdateInGame()

        if (this.inGamePlayers.length < 2) {
            if (0 < this.bets.pots.length && this.bets.pots.length < 2) this.bets.pots[0].amount += this.bets.total
            this.inGamePlayers[0].status.won.grossValue = this.bets.pots.length > 1 ? this.bets.pots.reduce((a, b) => { return a + b.amount }, 0) : (this.bets.pots[0] ? this.bets.pots[0].amount : this.bets.total)
            
            await this.ComputeRewards(this.players, this.inGamePlayers[0])
            this.SendMessage("wonBeforeEnd", this.inGamePlayers[0])
            this.bets.total = 0

            if (removed) return
            return this.NextHand()
        }

        if (!maxLimit) maxLimit = Math.max.apply(Math, this.inGamePlayers.filter((pl) => {
            return pl.id != player.id
        }).map((pl) => {
            return pl.stack + player.bets.current
        }))
        this.NextPlayer(this.inGamePlayers[currentPlayerIndex + (type == "fold" ? 0 : 1)], true, maxLimit)
    }

    async NextPlayer(player, betRound, maxLimit) {
        if (!this.playing) return
        await this.UpdateInGame()

        let movedone = this.inGamePlayers.every((pl) => {
            return pl.status.movedone
        }),
            sameBet = this.inGamePlayers.every((pl) => {
                return pl.bets.current == this.bets.currentMax &&
                    pl.stack > 0
            }),
            availablePlayers = this.inGamePlayers.filter((pl) => {
                return pl.stack > 0
            }),
            addedPots = false
        //A = 350 = POT 1400
        //B = 500 - 350 = | 150 - 60 = 90
        //C = 500 - 350 = | 150 - 60 = 90
        //D = 410 - 350 = | 60 = POT 180

        if (!sameBet && movedone) {
            let toMatch = await this.inGamePlayers.some((pl) => {
                return pl.bets.current < this.bets.currentMax &&
                    pl.stack > 0
            }) //TRUE IF AT LEAST A PLAYER IS NOT ALLIN AND HAS TO MATCH THE AMOUNT OF MONEY ON THE TABLE

            //IF EVERY PLAYER HAS MATCHED ANYWAY THE AMOUNT OF MONEY ON THE TABLE
            if (!toMatch) {
                var allinPlayers = await this.inGamePlayers.filter((pl) => {
                    return pl.stack < 1 && pl.bets.current > 0
                }).sort((a, b) => {
                    return a.bets.current - b.bets.current
                })

                //[3.500, 10.000, 26.500] 

                //[995, 23.526]
                
                //EVENTUALLY CONSIDERING: 4TH PLAYER (NOT ALL IN) [30.000 (RAISE BECAUSE OF ANOTHER PLAYER STACK IS 42.000)] 
                //EVENTUALLY CONSIDERING: 5TH PLAYER (NOT ALL IN) [30.000 (RAISE BECAUSE OF ANOTHER PLAYER STACK IS 42.000)]

                //SO THAT THE POT COULD BE:
                //16.500 * 3 = 49.500
                //THE REMAINING AMOUNT OF MONEY OF THE LAST 2 PLAYER COULD BE:
                //30.000 - 16.500 = 13.500
                //AND A NEW POT OF:
                //13.500 * 2 = 27.000
                //WILL BE CREATED
                
                for (let aip of allinPlayers) {
                    let pot = {
                        amount: aip.bets.current, //3.500 //6.500 //16.500
                        includedPlayers: await this.inGamePlayers.filter((pl) => {
                            return pl.bets.current >= aip.bets.current
                        }), //A, B, C //A, B //A
                        winners: []
                    }

                    this.bets.total -= aip.bets.current
                    
                    let nextPlayer = allinPlayers[allinPlayers.indexOf(aip) + 1]


                    //IF YOU ARE THE ONLY ONE WITH THIS AMOUNT OF MONEY ON THE TABLE
                    if (pot.includedPlayers.length < 2) {
                        aip.stack += aip.bets.current
                        aip.bets.total -= aip.bets.current
                        aip.bets.current = 0
                        this.bets.total = 0
                        continue
                    }

                    //ONLY ONCE FOR PLAYER B AND PLAYER C
                    //BEFORE, AFTER
                    //POT AMOUNT - 3.500, 10.500 //6.500, 13.000
                    //PLAYER B BETS CURRENT - 10.000, 6.500 //6.500
                    //PLAYER C BETS CURRENT - 26.500, 23.000 //23.000, 16.500
                    //BETS TOTAL = 36.515, 29.515 //23.015, 16.515
                    for (let incPlayer of pot.includedPlayers) {
                        if (incPlayer.id == aip.id) continue
                        pot.amount += aip.bets.current
                        incPlayer.bets.current -= aip.bets.current
                        this.bets.total -= aip.bets.current 
                    }
                    

                    aip.bets.current = 0

                    // ----- AFTER 1ST CYCLE -----
                    //TOTAL POT = 10.500 / 3 PLAYER = 3.500 EACH PLAYER
                    //PLAYER B BETS CURRENT = 6.500
                    //PLAYER C BETS CURRENT = 23.000
                    //BETS TOTAL = 29.515

                    // ----- AFTER 2ND CYCLE -----
                    //TOTAL POT = 13.000 / 2 PLAYER = 6.500 EACH PLAYER
                    //PLAYER B BETS CURRENT = 6.500
                    //PLAYER C BETS CURRENT = 16.500
                    //BETS TOTAL = 16.515 

                    await this.bets.pots.push(pot)

                    //IF THERE IS NOT ANY PLAYER TO SHARE THE REMAINING POT AFTER COMPUTING ALLIN POTS
                    if (!nextPlayer && pot.includedPlayers.length < 3) {
                        let remPlayer = pot.includedPlayers.find((pl) => {
                            return pl.id != aip.id
                        })
                        remPlayer.stack += remPlayer.bets.current
                        remPlayer.bets.current = 0
                        this.bets.total = 0
                    }


                }
                sameBet = true
                addedPots = true
            }
        }

        var goToNextPhase = () => {
            for (let pl of this.inGamePlayers) {
                if (pl.stack > 0 && pl.bets.current < this.bets.currentMax) pl.status.movedone = false
            }
            return this.NextPhase(
                this.tableCards.length == 0 ? "flop" :
                this.tableCards.length == 3 ? "turn" :
                this.tableCards.length == 4 ? "river" : 
                this.tableCards.length == 5 ? "showdown" : null,
            addedPots)
        }

        if ((!player && betRound && sameBet) || movedone) return goToNextPhase()
        
        if (player && player.stack < 1) {
            if (availablePlayers.length < 1) return goToNextPhase()
            return this.NextPlayer(this.inGamePlayers[this.inGamePlayers.indexOf(player) + 1], betRound, maxLimit)
        }

        if (this.inGamePlayers.includes(player)) this.GetPlayer(player.id).status.current = true
            else this.inGamePlayers.filter((pl) => {
                return pl.stack > 0
            })[0].status.current = true
        
        let p = this.inGamePlayers.find((pl) => {
            return pl.status.current
        })

        p.availableOptions = await this.GetAvailableOptions(p)

        this.timer = setTimeout(() => {
            if (!this.playing) return
            if (p.availableOptions.includes("check")) this.Action("check", p)
                else this.Action("fold", p)
        }, 40 * 1000)

        this.SendMessage("displayInfo", p, maxLimit)
    }

    async AddPlayer(player) {
        if (this.players.length + this.queue.length == this.maxPlayers) return this.SendMessage("maxPlayers", player)
        if (this.GetPlayer(player.id) || this.GetQueuePlayer(player.id)) return
        if (!this.playing && this.timeRun < 1) await this.players.push(player)
            else await this.queue.push(player)
        await this.SendMessage("playerAdded", player)
        if (!this.playing) this.Run()
    }

    async RemovePlayer(player, directRemove) {
        if (directRemove && this.GetPlayer(player.id)) return await this.players.splice(this.players.indexOf(player), 1)
        if (this.GetPlayer(player.id)) {
            if (!this.playing || player.status.removed) await this.players.splice(this.players.indexOf(player), 1)
                else {
                    this.UpdateInGame()
                    player.status.removed = true
                    await this.Action("fold", player, null, true)
                }
            await this.UpdateInGame()
            if (this.inGamePlayers.length < 2 && this.playing) {
                if (this.players.length > 0 && this.queue.length > 0) return this.NextHand()
                await this.players.splice(this.players.indexOf(player), 1)
                await this.SendMessage("playerRemoved", player)
                this.Reset()
                return this.Pause()
            }
        } else if (this.GetQueuePlayer(player.id))
            await this.queue.splice(this.queue.indexOf(this.GetQueuePlayer(player.id)), 1)
            else return
        await this.SendMessage("playerRemoved", player)   
    }

    async Reset(player) {
        if (player) {
            delete player.hand
            delete player.bets
            delete player.status
            delete player.newEntry
            return 
        }
        this.queue = []
        this.cards = [...cards]
        this.tableCards = []
        this.inGamePlayers = null
        this.bets = {
            minRaise: this.minBet,
            currentMax: 0,
            total: 0,
            pots: []
        }
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
    }

    Stop(options = {}) {
        const notify = Object.prototype.hasOwnProperty.call(options || {}, "notify") ? options.notify : true
        if (this.channel && this.channel.collector) this.channel.collector.stop()
        if (this.channel) this.channel.collector = null
        if (this.collector) this.collector.stop()
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.collector = null
        if (this.channel) {
            this.channel.game = null
            if (this.channel.prevRL && this.channel.manageable) this.channel.setRateLimitPerUser(this.channel.prevRL)
        }
        if (this.client && this.client.activeGames) this.client.activeGames.delete(this)
        if (notify) {
            return this.SendMessage("minPlayersDelete")
        }
        return null
    }
    Pause() {
        this.Reset(this.players[0])
        if (this.collector) this.collector.stop()
        if (this.timer) clearTimeout(this.timer)
        this.collector = null
        this.playing = false
        this.timer = setTimeout(() => {
            if (!this.playing) this.Stop()
        }, 45 * 1000)
        return this.SendMessage("minPlayersPause")
    }

    async Run(firstTime) {
        if (!firstTime && this.timeRun < 1) return
        if (this.players.length + this.queue.length < 2) return this.SendMessage("minPlayersDelete")
        if (!this.playing) {
            this.timeRun++
            clearTimeout(this.timer)
            this.timer = null
            if (!firstTime) {
                this.SendMessage("gameResumed")
                await delay(2000)
            }
            if (this.channel.manageable) {
                if (this.channel.RateLimitPerUser) this.channel.prevRL = this.channel.RateLimitPerUser
                this.channel.setRateLimitPerUser(5)
            } 
            this.playing = true
            this.NextHand()
        }
    }

}