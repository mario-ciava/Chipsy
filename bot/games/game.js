const Discord = require("discord.js")
const setSeparator = require("../utils/setSeparator")
const cards = require("./cards.js")
const features = require("./features.js")
const { calculateRequiredExp, normalizeUserExperience } = require("../utils/experience")
module.exports = class Game {
    constructor(info) {
        if (!info) return
        this.channel = info.message.channel || null
        this.minBet = info.minBet || null
        this.minBuyIn = info.minBuyIn|| info.minBet * 8 || null
        this.maxBuyIn = info.maxBuyIn || info.minBet * 40 || null
        this.maxPlayers = info.maxPlayers || null
        this.client = info.message.client
        this.dataHandler = this.client?.dataHandler
        if (!this.dataHandler) {
            throw new Error("Data handler is not available on the client.")
        }
        this.playing = false
        this.players = []
        this.queue = []
        this.tableCards = []
        this.inGamePlayers = null
        this.timer = null
        this.collector = null
        this.hands = 0
        this.timeRun = 0
        this.cards = [...cards]
    }

    async CardReplacer(cards) {
        if (!cards) return []
        var output = []
        for (let card of cards) {
            card = await card
                .replace(/T/g, "10")
                .replace(/S/g, "♠️")
                .replace(/C/g, "♣️")
                .replace(/H/g, "♥️")
                .replace(/D/g, "♦️")
            output.push(card)
        }
        return output
    }

    async Rotate(item, n) {
        return item.slice(n, item.length).concat(item.slice(0, n))
    }

    async PickRandom(items, n, remove = true, defined) {
        if (defined) {
            for (let item of defined)
                items.splice(items.indexOf(item), 1)
            return defined
        }
        var picked = []
        while(n > 0) {
            n--
            let selected = items[Math.floor(Math.random()*items.length)]
            if (remove) await items.splice(items.indexOf(selected), 1)
            picked.push(selected)
        }
        return picked
    }

    NextLevelMessage(player) {
        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .setFooter({
                text: `${player.tag} you have reached level ${player.data.level} | Your award: ${setSeparator(features.getLevelReward(player.data.level))}$`,
                iconURL: player.displayAvatarURL({ extension: "png" })
            })
        return this.channel.send({ embeds: [embed] })
    }

    async CheckExp(earned, player) {
        if (!player || !player.data) return

        Object.assign(player.data, normalizeUserExperience(player.data))
        player.data.current_exp += earned
        await new Promise((resolve, reject) => {
            while (player.data.current_exp >= player.data.required_exp) {
                player.data.level++
                this.NextLevelMessage(player)
                player.data.current_exp -= player.data.required_exp
                player.data.required_exp = calculateRequiredExp(player.data.level)
                player.data.money += features.getLevelReward(player.data.level)
                if (player.data.current_exp < player.data.required_exp) resolve()
            }
            if (player.data.current_exp < player.data.required_exp) {
                player.data.required_exp = calculateRequiredExp(player.data.level)
                resolve()
            }
        })
    }

    Shuffle(items) {
        if (!items) return null
        for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]]
        }
    }

    GetPlayer(id) {
        return this.players.find((player) => {
            return player.id == id
        })
    }

    GetQueuePlayer(id) {
        return this.queue.find((player) => {
            return player.id == id
        })
    }
}