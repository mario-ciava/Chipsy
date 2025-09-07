const Discord = require("discord.js")
const features = require("./features.js")
const { sleep } = require("../utils/helpers")
const Game = require("./game.js")
const cards = require("./cards.js")
const setSeparator = require("../utils/setSeparator")
const bankrollManager = require("../utils/bankrollManager")
const logger = require("../utils/logger")
const {
    renderCardTable,
    createBlackjackTableState
} = require("../rendering/cardTableRenderer")

// Game timing constants
const BETS_TIMEOUT_MS = 60000 // 60 seconds for bet placement
const BETS_TIMEOUT_DISPLAY = "60 seconds" // Display string for UI
const ACTION_TIMEOUT_MS = 30000 // 30 seconds per player action
const MODAL_TIMEOUT_MS = 25000 // 25 seconds for modal submission

module.exports = class BlackJack extends Game {
    constructor(info) {
        super(info)
        this.cards = [...cards, ...cards, ...cards],
        this.betsCollector = null,
        this.dealer = null
        this.dealerStatusMessage = null
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
        const sendEmbed = async(embed, components = [], additionalPayload = {}) => {
            try {
                const payload = { embeds: [embed], ...additionalPayload }
                if (components.length > 0) {
                    payload.components = components
                }
                const message = await channel.send(payload)
                return message
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
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setTitle("Dealer Status")
                    .setDescription(null)

                const payload = {}
                const activityLines = [
                    "Face-down card in play.",
                    "Awaiting dealer action."
                ]

                const snapshot = await this.captureTableRender({
                    title: `Dealer's Turn • Round #${this.hands}`,
                    filename: `blackjack_round_${this.hands}_dealer_${Date.now()}.png`,
                    description: `Dealer reveal snapshot for round ${this.hands}`,
                    hideDealerHoleCard: true,
                    maskDealerValue: true,
                    forceResult: null
                })
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    payload.files = [snapshot.attachment]
                }

                if (activityLines.length > 0) {
                    embed.setFields({ name: "Activity", value: activityLines.join("\n") })
                } else {
                    embed.setFields([])
                }
                embed.setFooter({ text: "Dealer will stand on 17 or higher." })
                const message = await sendEmbed(embed, [], payload)
                this.dealerStatusMessage = message
                return message
            break }
            case "showStartingCards": {
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setTitle(`Starting cards | Round #${this.hands}`)
                    .setDescription([
                        this.inGamePlayers.map((pl) => {
                            return `${pl} — Bet ${setSeparator(pl.bets.initial)}$`;
                        }).join("\n") || "-",
                        "**Dealer:** Starting hand prepared."
                    ].filter(Boolean).join("\n\n"))
                const payload = {}
                const snapshot = await this.captureTableRender({
                    title: `Starting Cards • Round #${this.hands}`,
                    filename: `blackjack_round_${this.hands}_starting_${Date.now()}.png`,
                    description: `Starting cards snapshot for round ${this.hands}`,
                    hideDealerHoleCard: true,
                    maskDealerValue: true,
                    forceResult: null
                })
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    payload.files = [snapshot.attachment]
                }
                await sendEmbed(embed, [], payload)
            break }
            case "showFinalResults": {
                const snapshot = await this.captureTableRender({
                    title: `Final Results • Round #${this.hands}`,
                    filename: `blackjack_round_${this.hands}_${Date.now()}.png`,
                    description: `Blackjack table snapshot for round ${this.hands}`,
                    forceResult: null
                })

                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Blue)
                    .setTitle("Dealer Status")
                    .setDescription(null)
                    .setFields([])
                    .setFooter({ text: "Dealer will stand on 17 or higher." })

                const payload = {}
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    payload.files = [snapshot.attachment]
                }

                const editPayload = {
                    embeds: [embed],
                    components: []
                }
                if (payload.files) {
                    editPayload.files = payload.files
                    editPayload.attachments = []
                }

                if (this.dealerStatusMessage && typeof this.dealerStatusMessage.edit === "function") {
                    try {
                        await this.dealerStatusMessage.edit(editPayload)
                    } catch (error) {
                        logger.error("Failed to update dealer status with final results", {
                            scope: "blackjackGame",
                            error: error.message
                        })
                        this.dealerStatusMessage = await sendEmbed(embed, [], payload)
                    }
                } else {
                    this.dealerStatusMessage = await sendEmbed(embed, [], payload)
                }
            break }
            case "displayInfo": {
                const handSummary = player.hands.map((hand, idx) => {
                    const isCurrent = idx === player.status.currentHand;
                    const statusParts = [Number.isFinite(hand.value) ? `${hand.value}` : "??"];
                    if (hand.busted) statusParts.push("Busted");
                    if (hand.BJ) statusParts.push("Blackjack");
                    if (hand.push) statusParts.push("Push");
                    return `${isCurrent && !info ? "▶ " : ""}Hand #${idx + 1} • ${statusParts.join(" • ")}`;
                }).join("\n") || "No cards drawn yet.";

                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Gold)
                    .setTitle(`${player.tag} — Hand status`)
                    .setDescription([
                        handSummary,
                        info ? "*Standing automatically*" : null
                    ].filter(Boolean).join("\n\n"))
                    .setFooter({
                        text: `Total bet: ${setSeparator(player.bets.total)}$ | Insurance: ${player.bets.insurance > 0 ? setSeparator(player.bets.insurance) + "$" : "no"} | 30s left`,
                        iconURL: clientAvatar
                    })

                const components = []
                if (player.availableOptions && player.availableOptions.length > 0 && !info) {
                    const row = new Discord.ActionRowBuilder()
                    const optionButtons = {
                        stand: { label: "Stand", style: Discord.ButtonStyle.Secondary, emoji: "🛑" },
                        hit: { label: "Hit", style: Discord.ButtonStyle.Primary, emoji: "🎯" },
                        double: { label: "Double", style: Discord.ButtonStyle.Success, emoji: "💰" },
                        split: { label: "Split", style: Discord.ButtonStyle.Success, emoji: "✂️" },
                        insurance: { label: "Insurance", style: Discord.ButtonStyle.Danger, emoji: "🛡️" }
                    }
                    for (const option of player.availableOptions) {
                        if (optionButtons[option]) {
                            const btn = optionButtons[option]
                            row.addComponents(
                                new Discord.ButtonBuilder()
                                    .setCustomId(`bj_action:${option}:${player.id}`)
                                    .setLabel(btn.label)
                                    .setStyle(btn.style)
                                    .setEmoji(btn.emoji)
                            )
                        }
                    }
                    components.push(row)
                }

                const payload = {}
                const snapshot = await this.captureTableRender({
                    title: `${player.tag} • Round #${this.hands}`,
                    filename: `blackjack_round_${this.hands}_info_${player.id}_${Date.now()}.png`,
                    description: `Snapshot for ${player.tag} during round ${this.hands}`,
                    focusPlayerId: player.id,
                    hideDealerHoleCard: true,
                    maskDealerValue: true,
                    forceResult: null
                })
                if (snapshot) {
                    embed.setImage(`attachment://${snapshot.filename}`)
                    payload.files = [snapshot.attachment]
                }

                const existingMessage = player.status?.infoMessage
                if (existingMessage && typeof existingMessage.edit === "function") {
                    const editPayload = {
                        embeds: [embed],
                        components
                    }
                    if (payload.files) {
                        editPayload.files = payload.files
                        editPayload.attachments = []
                    }
                    try {
                        await existingMessage.edit(editPayload)
                    } catch (error) {
                        logger.error("Failed to update hand status message", {
                            scope: "blackjackGame",
                            playerId: player.id,
                            error: error.message
                        })
                        player.status.infoMessage = null
                    }
                }

                if (!player.status.infoMessage) {
                    const message = await sendEmbed(embed, components, payload)
                    if (message) {
                        player.status.infoMessage = message
                    }
                }
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
                    .setTitle("Busted!")
                    .setDescription(`Hand #${player.hands.indexOf(info) + 1} • ${Number.isFinite(info.value) ? info.value : "??"} • Busted`)
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
                    .setTitle(`Bets opened | Round #${this.hands}`)
                    .setDescription("Click **Bet** to place your bet, or **Leave** to exit the game.")
                    .addFields({
                        name: "Available stacks",
                        value: `${this.players
                            .filter((p) => {
                                return !p.newEntry
                            })
                            .map((p) => {
                                return `${p} - Stack: ${setSeparator(p.stack)}$`
                            })
                            .join("\n") || "-"}`
                    })
                    .setFooter({ text: `You have got ${BETS_TIMEOUT_DISPLAY} | Deck remaining cards: ${this.cards.length}` })

                const components = [
                    new Discord.ActionRowBuilder().addComponents(
                        new Discord.ButtonBuilder()
                            .setCustomId("bj_bet:place")
                            .setLabel("Bet")
                            .setStyle(Discord.ButtonStyle.Success)
                            .setEmoji("💰"),
                        new Discord.ButtonBuilder()
                            .setCustomId("bj_bet:autobet")
                            .setLabel("Autobet")
                            .setStyle(Discord.ButtonStyle.Primary)
                            .setEmoji("🔄"),
                        new Discord.ButtonBuilder()
                            .setCustomId("bj_bet:leave")
                            .setLabel("Leave")
                            .setStyle(Discord.ButtonStyle.Danger)
                            .setEmoji("🚪")
                    )
                ]

                return await sendEmbed(embed, components)
            }
            case "betsClosed": {
                const allBetsPlaced = info?.allBetsPlaced === true
                const message = allBetsPlaced
                    ? "All players have placed their bets"
                    : "Time is up"
                const embed = new Discord.EmbedBuilder()
                    .setColor(Discord.Colors.Red)
                    .setTitle(`Bets closed | Round #${this.hands}`)
                    .setDescription(message)
                await sendEmbed(embed)
            break }
        }
    }

    async captureTableRender(options = {}) {
        const {
            dealer = this.dealer,
            players = this.inGamePlayers,
            title = null,
            focusPlayerId = null,
            result = null,
            appearance,
            filename,
            description,
            playerName,
            hideDealerHoleCard = false,
            maskDealerValue,
            forceResult
        } = options

        if (!dealer || !Array.isArray(dealer.cards) || dealer.cards.length < 1) {
            return null
        }

        const preparedPlayers = []
        for (const player of players ?? []) {
            if (!player || !Array.isArray(player.hands)) continue
            const baseHands = player.hands
                .filter((hand) => Array.isArray(hand?.cards) && hand.cards.length > 0)
                .map((hand) => ({
                    ...hand,
                    cards: [...hand.cards]
                }))
            const totalHandsForXp = baseHands.length || 1
            const totalXpEarned = Number.isFinite(player.status?.won?.expEarned) ? player.status.won.expEarned : 0
            const distributedXp = totalXpEarned > 0 ? Math.round(totalXpEarned / totalHandsForXp) : 0
            const validHands = baseHands.map((hand) => ({
                ...hand,
                xp: Number.isFinite(hand.xp) ? hand.xp : (distributedXp > 0 ? distributedXp : null)
            }))
            if (validHands.length === 0) continue
            preparedPlayers.push({
                id: player.id,
                tag: player.tag,
                username: player.username,
                displayName: player.displayName,
                name: player.name,
                user: player.user,
                hands: validHands
            })
        }

        if (preparedPlayers.length === 0) {
            return null
        }

        const dealerCardsCopy = Array.isArray(dealer.cards) ? [...dealer.cards] : []
        const computeVisibleValue = cards => {
            let total = 0
            let aces = 0
            for (const card of cards) {
                const rank = card?.[0]
                if (!rank) continue
                if (rank === "A") {
                    total += 11
                    aces++
                } else if (["K", "Q", "J", "T"].includes(rank)) {
                    total += 10
                } else {
                    const parsed = parseInt(rank, 10)
                    total += Number.isFinite(parsed) ? parsed : 0
                }
            }
            while (total > 21 && aces > 0) {
                total -= 10
                aces--
            }
            return total
        }

        const concealDealerInfo = typeof maskDealerValue === "boolean" ? maskDealerValue : hideDealerHoleCard
        const visibleCards = hideDealerHoleCard
            ? dealerCardsCopy.filter((_, idx) => idx !== 1)
            : dealerCardsCopy

        const dealerState = {
            ...dealer,
            cards: dealerCardsCopy,
            value: concealDealerInfo
                ? computeVisibleValue(visibleCards)
                : (dealer.value ?? dealer.total ?? dealer.score ?? 0),
            blackjack: concealDealerInfo ? false : Boolean(dealer.blackjack || dealer.hasBlackjack || dealer.BJ),
            busted: concealDealerInfo ? false : Boolean(dealer.busted || dealer.isBusted)
        }

        const resolvedPlayerName =
            playerName
            || preparedPlayers[0]?.displayName
            || preparedPlayers[0]?.username
            || preparedPlayers[0]?.tag
            || this.host?.tag
            || this.client?.user?.username
            || "Player"

        try {
            const state = createBlackjackTableState({
                dealer: dealerState,
                players: preparedPlayers,
                round: this.hands,
                id: this.id
            }, {
                title,
                focusPlayerId,
                result,
                appearance: appearance ?? {},
                round: this.hands,
                tableId: this.id,
                playerName: resolvedPlayerName,
                maskDealerHoleCard: hideDealerHoleCard
            })

            state.metadata = {
                ...(state.metadata ?? {}),
                maskDealerHoleCard: hideDealerHoleCard
            }

            if (forceResult !== undefined) {
                state.result = forceResult
            }

            const buffer = await renderCardTable({ ...state, outputFormat: "png" })
            const resolvedFilename = filename ?? `blackjack_table_${this.hands}_${Date.now()}.png`

            return {
                attachment: new Discord.AttachmentBuilder(buffer, {
                    name: resolvedFilename,
                    description: description ?? `Blackjack table snapshot for round ${this.hands}`
                }),
                filename: resolvedFilename
            }
        } catch (error) {
            logger.error("Failed to render blackjack table snapshot", {
                scope: "blackjackGame",
                round: this.hands,
                tableId: this.id,
                error: error.message,
                stack: error.stack
            })
            return null
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
            await sleep(2000)
        }

        for (let player of this.players) {
            // Stack is maintained from buy-in and previous hands, not reset to bankroll
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
                },
                infoMessage: null
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

        this.dealerStatusMessage = null

        this.hands++

        this.AwaitBets()
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
                    player.hands = []
                    player.hands.push({
                        cards: await this.PickRandom(this.cards, 2),
                        bet,
                        settled: false,
                        fromSplitAce: false,
                        result: null,
                        payout: 0
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

        this.betsMessage = await this.SendMessage("betsOpened")
        if (!this.betsMessage) {
            logger.error("Failed to send betsOpened message", {
                scope: "blackjackGame",
                channelId: this.channel?.id
            })
            return this.Stop({ reason: "error", notify: false })
        }

        // If all bets placed via autobet, use short timeout (3 seconds) to allow disable
        const betTimeout = allBetsPlaced ? 3000 : BETS_TIMEOUT_MS

        this.betsCollector = this.betsMessage.createMessageComponentCollector({
            filter: (interaction) => {
                if (!interaction || interaction.user?.bot) return false
                if (!interaction.customId || !interaction.customId.startsWith("bj_bet:")) return false
                const player = this.GetPlayer(interaction.user.id)
                return player !== null
            },
            time: betTimeout
        })

        this.betsCollector.on("collect", async(interaction) => {
            const [, action] = interaction.customId.split(":")
            const player = this.GetPlayer(interaction.user.id)

            if (!player || !player.data) {
                await interaction.reply({ content: "⚠️ You are not in this game.", ephemeral: true }).catch(() => null)
                return
            }

            if (action === "leave") {
                await interaction.deferUpdate().catch(() => null)

                // Update bets message to show player leaving
                await this.UpdateBetsMessageForLeave(player)

                await this.RemovePlayer(player)

                // Check if all players left during betting phase
                if (this.players.length === 0) {
                    // Stop collector and game
                    if (this.betsCollector) this.betsCollector.stop("allPlayersLeft")
                }
                return
            }

            if (action === "autobet") {
                if (player.bets && player.bets.initial > 0) {
                    const reply = await interaction.reply({
                        content: "⚠️ You have already placed your bet for this round.",
                        ephemeral: true
                    }).catch(() => null)

                    if (reply) {
                        setTimeout(() => {
                            interaction.deleteReply().catch(() => null)
                        }, 5000)
                    }
                    return
                }

                // Show select menu for number of rounds
                const selectMenu = new Discord.StringSelectMenuBuilder()
                    .setCustomId(`bj_autobet_rounds:${interaction.user.id}:${interaction.message.id}`)
                    .setPlaceholder("How many rounds?")
                    .addOptions([
                        {
                            label: "3 rounds",
                            value: "3",
                            emoji: "3️⃣"
                        },
                        {
                            label: "4 rounds",
                            value: "4",
                            emoji: "4️⃣"
                        },
                        {
                            label: "5 rounds",
                            value: "5",
                            emoji: "5️⃣"
                        }
                    ])

                const row = new Discord.ActionRowBuilder().addComponents(selectMenu)

                const setupReply = await interaction.reply({
                    content: "🔄 **Autobet Setup**\n\nSelect how many consecutive rounds you want to autobet:",
                    components: [row],
                    ephemeral: true
                }).catch(() => null)

                // Wait for select menu interaction
                const selectFilter = (i) => i.customId.startsWith("bj_autobet_rounds:") && i.user.id === interaction.user.id
                const selectCollector = interaction.channel.createMessageComponentCollector({
                    filter: selectFilter,
                    time: 30000,
                    max: 1
                })

                selectCollector.on("collect", async(selectInteraction) => {
                    const rounds = parseInt(selectInteraction.values[0])

                    // Delete the setup message after selection
                    if (setupReply) {
                        interaction.deleteReply().catch(() => null)
                    }

                    // Now show modal for bet amount
                    const modalCustomId = `bj_autobet_modal:${selectInteraction.message.id}:${selectInteraction.user.id}:${rounds}`
                    const modal = new Discord.ModalBuilder()
                        .setCustomId(modalCustomId)
                        .setTitle("Autobet Amount")

                    const betInput = new Discord.TextInputBuilder()
                        .setCustomId("bet_amount")
                        .setLabel(`Bet amount (per round, ${rounds} times)`)
                        .setStyle(Discord.TextInputStyle.Short)
                        .setPlaceholder(`Min: ${setSeparator(this.minBet)}$ | Max: ${setSeparator(Math.min(this.maxBuyIn, player.stack))}$`)
                        .setRequired(true)

                    const actionRow = new Discord.ActionRowBuilder().addComponents(betInput)
                    modal.addComponents(actionRow)

                    await selectInteraction.showModal(modal).catch(() => null)

                    // Wait for modal submission
                    let submission
                    try {
                        submission = await selectInteraction.awaitModalSubmit({
                            time: MODAL_TIMEOUT_MS,
                            filter: (i) => i.customId === modalCustomId && i.user.id === selectInteraction.user.id
                        })
                    } catch (error) {
                        return
                    }

                    if (!submission) return

                    await submission.deferUpdate().catch(() => null)

                    const betAmountStr = submission.fields.getTextInputValue("bet_amount")
                    const bet = features.inputConverter(betAmountStr)

                    if (!Number.isFinite(bet) || bet < this.minBet || bet > this.maxBuyIn) {
                        await submission.followUp({ content: `❌ Invalid bet amount. Please bet between ${setSeparator(this.minBet)}$ and ${setSeparator(this.maxBuyIn)}$`, ephemeral: true }).catch(() => null)
                        return
                    }

                    if (!bankrollManager.withdrawStackOnly(player, bet)) {
                        await submission.followUp({ content: "❌ Insufficient funds.", ephemeral: true }).catch(() => null)
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
                        payout: 0
                    })

                    if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
                    await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))

                    // Update the bets message
                    await this.UpdateBetsMessage(this.betsMessage)

                    const confirmReply = await submission.followUp({
                        content: `✅ Autobet active: ${setSeparator(bet)}$ x ${rounds} rounds\n💰 First bet placed: ${setSeparator(bet)}$`,
                        ephemeral: true
                    }).catch(() => null)

                    // Delete after 5 seconds
                    if (confirmReply) {
                        setTimeout(() => {
                            submission.deleteReply().catch(() => null)
                        }, 5000)
                    }

                    let remaining = this.players.filter((player) => {
                        return player.bets ? player.bets.initial < 1 : true == false
                    }).length

                    if (remaining < 1) this.betsCollector.stop("allBetsPlaced")
                })

                return
            }

            if (action === "place") {
                if (player.bets && player.bets.initial > 0) {
                    const reply = await interaction.reply({
                        content: "⚠️ You have already placed your bet for this round.",
                        ephemeral: true
                    }).catch(() => null)

                    if (reply) {
                        setTimeout(() => {
                            interaction.deleteReply().catch(() => null)
                        }, 5000)
                    }
                    return
                }

                // Show modal for bet amount
                const modalCustomId = `bj_bet_modal:${interaction.message.id}:${interaction.user.id}`
                const modal = new Discord.ModalBuilder()
                    .setCustomId(modalCustomId)
                    .setTitle("Place your bet")
                    .addComponents(
                        new Discord.ActionRowBuilder().addComponents(
                            new Discord.TextInputBuilder()
                                .setCustomId("betAmount")
                                .setLabel("Bet amount (e.g., 10k or leave empty for min)")
                                .setStyle(Discord.TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder(`Min: ${setSeparator(this.minBet)}$`)
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
                        time: MODAL_TIMEOUT_MS,
                        filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id
                    })
                } catch (error) {
                    return
                }

                if (!submission) return

                const rawBetInput = submission.fields.getTextInputValue("betAmount")?.trim()
                const parsedBet = rawBetInput ? features.inputConverter(rawBetInput) : this.minBet
                let bet = parsedBet

                if (!Number.isFinite(bet) || bet <= 0) {
                    await submission.reply({ content: "❌ Invalid bet amount.", ephemeral: true }).catch(() => null)
                    return
                }

                bet = Math.floor(bet)

                if (bet < this.minBet) {
                    await submission.reply({ content: `❌ Minimum bet is ${setSeparator(this.minBet)}$.`, ephemeral: true }).catch(() => null)
                    return
                }

                if (!bankrollManager.canAffordStack(player, bet)) {
                    await submission.reply({ content: "❌ You don't have enough chips for that bet.", ephemeral: true }).catch(() => null)
                    return
                }

                if (!bankrollManager.withdrawStackOnly(player, bet)) {
                    await submission.reply({ content: "❌ Failed to place bet.", ephemeral: true }).catch(() => null)
                    return
                }

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
                    fromSplitAce: false,
                    result: null,
                    payout: 0
                })

                if (bet > player.data.biggest_bet) player.data.biggest_bet = bet
                await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))

                // Update the bets message instead of sending a new one
                await this.UpdateBetsMessage(this.betsMessage)

                // Send ephemeral message that auto-deletes after 5 seconds
                const replied = await submission
                    .reply({ content: `✅ Bet placed: ${setSeparator(bet)}$`, ephemeral: true })
                    .then(() => true)
                    .catch(() => false)

                if (replied) {
                    setTimeout(() => {
                        submission.deleteReply().catch(() => null)
                    }, 5000)
                }

                let remaining = this.players.filter((player) => {
                    return player.bets ? player.bets.initial < 1 : true == false
                }).length

                if (remaining < 1) this.betsCollector.stop("allBetsPlaced")
            }
        })
        this.betsCollector.on("end", async(coll, reason) => {
            await this.UpdateInGame()

            // If all players left during betting, stop game without further messages
            if (reason === "allPlayersLeft") {
                return this.Stop({ reason: "allPlayersLeft", notify: false })
            }

            if (this.inGamePlayers.length < 1 && this.playing) {
                // No bets placed - stop game without showing "bets closed" message
                return this.Stop({ reason: "noBetsPlaced" })
            }

            // Bets were placed - modify existing bets message to show closed state
            const allBetsPlaced = reason === "allBetsPlaced"
            await this.CloseBetsMessage(allBetsPlaced)
            await sleep(1000)
            if (!this.collector) await this.CreateOptions()
            this.betsCollector = null
            if (this.inGamePlayers.length > 1) {
                await sleep(2000)
                this.SendMessage("showStartingCards")
            }
            this.dealer.cards = await this.PickRandom(this.cards, 2)
            await sleep(2000)
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

        const currentHand = currentPlayer.hands[currentPlayer.status.currentHand]
        // Auto-stand on 21 or blackjack
        if (currentHand.BJ || currentHand.value === 21 || auto) {
            clearTimeout(this.timer)
            this.timer = null
            currentPlayer.availableOptions = []
            await sleep(2000)
            this.SendMessage("displayInfo", currentPlayer, true)
            await sleep(3500)
            return this.Action("stand", currentPlayer, currentPlayer.status.currentHand, true)
        }
        await sleep(2000)
        this.SendMessage("displayInfo", currentPlayer)
    }

    async UpdateBetsMessage(message) {
        if (!message || typeof message.edit !== "function") return

        // Build list of bet statuses for each player
        const betStatuses = this.players.filter((p) => !p.newEntry).map((p) => {
            const hasBet = p.bets && p.bets.initial > 0
            const betDisplay = hasBet
                ? `✅ ${setSeparator(p.bets.initial)}$`
                : "⏳ Waiting..."
            return `${p} - ${betDisplay}`
        })

        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Green)
            .setTitle(`Bets opened | Round #${this.hands}`)
            .setDescription("Click **Bet** to place your bet, or **Leave** to exit the game.")
            .addFields({
                name: "Bet Status",
                value: betStatuses.join("\n") || "—"
            })
            .setFooter({ text: `You have got ${BETS_TIMEOUT_DISPLAY} | Deck remaining cards: ${this.cards.length}` })

        // Keep the same buttons from the original message
        const components = message.components

        try {
            await message.edit({ embeds: [embed], components })
        } catch (error) {
            logger.error("Failed to update bets message", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message
            })
        }
    }

    async UpdateBetsMessageForLeave(leavingPlayer) {
        if (!this.betsMessage || typeof this.betsMessage.edit !== "function") return

        // Build current bet list
        const betStatuses = this.players.filter((p) => !p.newEntry && p.id !== leavingPlayer.id).map((p) => {
            const hasBet = p.bets && p.bets.initial > 0
            const betDisplay = hasBet
                ? `✅ ${setSeparator(p.bets.initial)}$`
                : "⏳ Waiting..."
            return `${p} - ${betDisplay}`
        })

        // Check if this was the last player
        const isLastPlayer = this.players.filter(p => p.id !== leavingPlayer.id).length === 0

        if (isLastPlayer) {
            // Game will be cancelled - show final message
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Orange)
                .setTitle(`Game Cancelled | Round #${this.hands}`)
                .setDescription(`${leavingPlayer} left the game.\n\nAll players have left. The game has been cancelled.`)
                .setFooter({ text: "Start a new game to play" })

            // Disable all buttons
            const disabledComponents = this.betsMessage.components.map((row) => {
                const newRow = Discord.ActionRowBuilder.from(row)
                newRow.components.forEach((component) => {
                    if (typeof component.setDisabled === 'function') {
                        component.setDisabled(true)
                    }
                })
                return newRow
            })

            try {
                await this.betsMessage.edit({ embeds: [embed], components: disabledComponents })
            } catch (error) {
                logger.error("Failed to update bets message for leave", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: error.message
                })
            }
        } else {
            // Game continues - just update the player list
            const embed = new Discord.EmbedBuilder()
                .setColor(Discord.Colors.Yellow)
                .setTitle(`Bets opened | Round #${this.hands}`)
                .setDescription(`${leavingPlayer} left the game.\n\nClick **Bet** to place your bet, or **Leave** to exit the game.`)
                .addFields({
                    name: "Bet Status",
                    value: betStatuses.join("\n") || "—"
                })
                .setFooter({ text: `You have got ${BETS_TIMEOUT_DISPLAY} | Deck remaining cards: ${this.cards.length}` })

            // Keep the same buttons
            const components = this.betsMessage.components

            try {
                await this.betsMessage.edit({ embeds: [embed], components })
            } catch (error) {
                logger.error("Failed to update bets message for leave", {
                    scope: "blackjackGame",
                    channelId: this.channel?.id,
                    error: error.message
                })
            }
        }
    }

    async CloseBetsMessage(allBetsPlaced = false) {
        if (!this.betsMessage || typeof this.betsMessage.edit !== "function") return

        const message = allBetsPlaced
            ? "All players have placed their bets"
            : "Time is up"

        // Build final bet list
        const betStatuses = this.players.filter((p) => !p.newEntry).map((p) => {
            const hasBet = p.bets && p.bets.initial > 0
            const betDisplay = hasBet
                ? `✅ ${setSeparator(p.bets.initial)}$`
                : "❌ No bet"
            return `${p} - ${betDisplay}`
        })

        const embed = new Discord.EmbedBuilder()
            .setColor(Discord.Colors.Red)
            .setTitle(`Bets closed | Round #${this.hands}`)
            .setDescription(message)
            .addFields({
                name: "Final Bets",
                value: betStatuses.join("\n") || "—"
            })

        // Check if any player has active autobet
        const playersWithAutobet = this.players.filter(p => p.autobet && p.autobet.remaining > 0)

        let components = []

        if (playersWithAutobet.length > 0) {
            // Single button for all players with autobet
            const autobetRow = new Discord.ActionRowBuilder()
            autobetRow.addComponents(
                new Discord.ButtonBuilder()
                    .setCustomId("bj_disable_autobet")
                    .setLabel("Disable Autobet")
                    .setStyle(Discord.ButtonStyle.Danger)
                    .setEmoji("🛑")
            )

            components.push(autobetRow)

            // Set up a temporary collector for disable autobet button
            const disableCollector = this.betsMessage.createMessageComponentCollector({
                filter: (i) => i.customId === "bj_disable_autobet",
                time: 5000 // 5 seconds to disable
            })

            disableCollector.on("collect", async(interaction) => {
                const player = this.GetPlayer(interaction.user.id)

                if (!player || !player.autobet) {
                    const reply = await interaction.reply({
                        content: "❌ You don't have an active autobet.",
                        ephemeral: true
                    }).catch(() => null)

                    // Delete after 5 seconds
                    if (reply) {
                        setTimeout(() => {
                            interaction.deleteReply().catch(() => null)
                        }, 5000)
                    }
                    return
                }

                delete player.autobet
                const reply = await interaction.reply({
                    content: "✅ Autobet disabled successfully.",
                    ephemeral: true
                }).catch(() => null)

                // Delete after 5 seconds
                if (reply) {
                    setTimeout(() => {
                        interaction.deleteReply().catch(() => null)
                    }, 5000)
                }

                // Check if anyone still has autobet
                const stillHaveAutobet = this.players.some(p => p.autobet && p.autobet.remaining > 0)
                if (!stillHaveAutobet) {
                    // Remove the button
                    try {
                        await this.betsMessage.edit({ embeds: [embed], components: [] })
                    } catch (error) {
                        logger.error("Failed to update autobet button", {
                            scope: "blackjackGame",
                            error: error.message
                        })
                    }
                }
            })
        } else {
            // No autobet - disable all betting buttons
            const disabledComponents = this.betsMessage.components.map((row) => {
                const newRow = Discord.ActionRowBuilder.from(row)
                newRow.components.forEach((component) => {
                    if (typeof component.setDisabled === 'function') {
                        component.setDisabled(true)
                    }
                })
                return newRow
            })
            components = disabledComponents
        }

        try {
            await this.betsMessage.edit({ embeds: [embed], components })
        } catch (error) {
            logger.error("Failed to close bets message", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message
            })
        }
    }

    async UpdateDealerMessage(message, action, newCard = null) {
        if (!message || typeof message.edit !== "function") return

        this.dealerStatusMessage = message

        let actionText = ""
        let color = Discord.Colors.Blue
        let activityLines = []

        switch (action) {
            case "hit":
                actionText = "Dealer hits!"
                color = Discord.Colors.Purple
                activityLines = [
                    "Dealer draws a new card.",
                    this.dealer.busted ? "Dealer busted!" : `Total: ${this.dealer.value}`
                ].filter(Boolean)
                break
            case "stand":
                actionText = "Dealer stands!"
                color = Discord.Colors.Green
                activityLines = [
                    "Dealer stands.",
                    `Final total: ${this.dealer.value}${this.dealer.BJ ? " • Blackjack" : ""}`
                ]
                break
            case "busted":
                actionText = "Dealer busted!"
                color = Discord.Colors.Red
                activityLines = [
                    "Dealer exceeded 21.",
                    `Total: ${this.dealer.value}`,
                    "Proceeding to payouts."
                ]
                break
            default:
                actionText = "Dealer's turn"
                activityLines = [
                    "Dealer is evaluating next move.",
                    `Current total: ${this.dealer.value}`
                ]
        }

        const embed = new Discord.EmbedBuilder()
            .setColor(color)
            .setTitle("Dealer Status")
            .setDescription(null)

        const snapshot = await this.captureTableRender({
            title: `Dealer's Turn • Round #${this.hands}`,
            filename: `blackjack_round_${this.hands}_dealer_update_${Date.now()}.png`,
            description: `Dealer action snapshot for round ${this.hands}`,
            forceResult: null,
            hideDealerHoleCard: false,
            maskDealerValue: false
        })

        const editPayload = { embeds: [embed] }
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            editPayload.files = [snapshot.attachment]
            editPayload.attachments = []
        } else {
            embed.setImage(null)
            editPayload.attachments = []
        }

        if (activityLines.length > 0) {
            embed.setFields({ name: "Activity", value: activityLines.join("\n") })
        } else {
            embed.setFields([])
        }
        embed.setFooter({ text: "Dealer will stand on 17 or higher." })

        try {
            await message.edit(editPayload)
        } catch (error) {
            logger.error("Failed to update dealer message", {
                scope: "blackjackGame",
                channelId: this.channel?.id,
                error: error.message
            })
        }
    }

    async CreateOptions() {
        // Component collector for button interactions
        this.collector = this.channel.createMessageComponentCollector({
            filter: (interaction) => {
                if (!interaction || interaction.user?.bot) return false
                if (!interaction.customId || !interaction.customId.startsWith("bj_action:")) return false
                const player = this.GetPlayer(interaction.user.id)
                return player && player.status && player.status.current
            },
            time: 5 * 60 * 1000 // 5 minutes timeout
        })
        this.collector.on("collect", async(interaction) => {
            const [, action, playerId] = interaction.customId.split(":")
            const player = this.GetPlayer(playerId)

            if (!player || !player.status || !player.status.current) {
                await interaction.reply({ content: "⚠️ It's not your turn.", ephemeral: true }).catch(() => null)
                return
            }

            if (interaction.user.id !== playerId) {
                await interaction.reply({ content: "⚠️ It's not your turn.", ephemeral: true }).catch(() => null)
                return
            }

            await interaction.deferUpdate().catch(() => null)
            this.Action(action, player, player.status.currentHand)
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
        const canAffordBaseBet = bankrollManager.canAffordStack(player, player.bets?.initial)
        if (hand.cards.length < 3 && canAffordBaseBet) available.push("double")
        if (hand.pair && player.hands.length < 4 && canAffordBaseBet) available.push("split")
        const insuranceBet = Math.floor(player.bets.initial / 2)
        const dealerUpCard = (this.dealer?.cards?.[0] || "").split("")[0]
        if (dealerUpCard == "A" && player.bets.insurance < 1 && hand.cards.length < 3 && insuranceBet > 0 && bankrollManager.canAffordStack(player, insuranceBet)) available.push("insurance")
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
                if (additionalBet < 1 || !bankrollManager.canAffordStack(player, additionalBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                player.hands[hand].cards = player.hands[hand].cards.concat(await this.PickRandom(this.cards, 1))
                if (!bankrollManager.withdrawStackOnly(player, additionalBet)) {
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
                if (splitCost < 1 || !bankrollManager.canAffordStack(player, splitCost)) {
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
                    fromSplitAce: splitAce,
                    result: null,
                    payout: 0
                })
                currentHand.cards = await currentHand.cards.concat(await this.PickRandom(this.cards, 1))
                await this.ComputeHandsValue(player)
                if (!bankrollManager.withdrawStackOnly(player, splitCost)) {
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
                if (!bankrollManager.canAffordStack(player, insuranceBet)) {
                    await this.SendMessage("noMoneyBet", player)
                    return this.NextPlayer(player)
                }
                if (!bankrollManager.withdrawStackOnly(player, insuranceBet)) {
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

        await sleep(2000)
        await this.ComputeHandsValue(player)

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

        // Show initial dealer cards
        const dealerMessage = await this.SendMessage("showDealer")
        await sleep(3500)

        // Dealer draws cards until 17 or higher
        while (this.dealer.value < 17) {
            const newCard = await this.PickRandom(this.cards, 1)
            this.dealer.cards = this.dealer.cards.concat(newCard)
            await this.ComputeHandsValue(null, this.dealer)

            // Update the same embed instead of sending new messages, highlighting new card
            if (dealerMessage) {
                await this.UpdateDealerMessage(dealerMessage, "hit", newCard[0])
                await sleep(3500)
            }
        }

        // Final dealer status update
        if (dealerMessage) {
            const finalAction = this.dealer.busted ? "busted" : "stand"
            await this.UpdateDealerMessage(dealerMessage, finalAction)
            await sleep(3500)
        }

        for (let player of this.inGamePlayers) {
                player.status.won.expEarned += 10
                // Count total hands played (important for split scenarios)
                player.data.hands_played += player.hands.length
            const insuranceWager = player.status.insurance?.wager || 0
            if (this.dealer.BJ && insuranceWager > 0 && !player.status.insurance.settled) {
                const insurancePayout = insuranceWager * 3
                bankrollManager.depositStackOnly(player, insurancePayout)
                player.status.insurance.settled = true
                player.status.won.grossValue += insurancePayout
                player.status.won.netValue += (insurancePayout - insuranceWager)
                await this.SendMessage("insuranceRefund", player, { payout: insurancePayout })
                await sleep(1000)
            }
            for (let hand of player.hands) {
                let wf = 1
                let handWon = false
                hand.result = null
                hand.payout = 0
                if (hand.busted) {
                    hand.result = "lose"
                    hand.payout = -hand.bet
                    continue
                }

                // Determine outcome and win factor
                if (this.dealer.busted) {
                    // Dealer busted - player wins
                    wf = hand.BJ ? 2.5 : 2
                    handWon = true
                    hand.result = "win"
                } else {
                    // Dealer not busted
                    if (hand.value < this.dealer.value) {
                        // Player loses
                        hand.result = "lose"
                        hand.payout = -hand.bet
                        continue
                    } else if (hand.value == this.dealer.value) {
                        // Push - return bet only (not counted as win)
                        hand.push = true
                        wf = 1
                        handWon = false
                        hand.result = "push"
                    } else {
                        // Player wins (hand.value > dealer.value)
                        wf = hand.BJ ? 2.5 : 2
                        handWon = true
                        hand.result = "win"
                    }
                }

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
                }

                // Count individual hand wins
                if (handWon) {
                    player.data.hands_won++
                }
            }
            if (player.status.won.grossValue > 0) {
                player.status.won.expEarned += parseInt((Math.log(player.status.won.grossValue)) * (1.2 + (Math.sqrt(player.status.won.grossValue) * 0.003)) + 10)
            }
            if (player.status.won.grossValue > player.data.biggest_won) player.data.biggest_won = player.status.won.grossValue
            await this.CheckExp(player.status.won.expEarned, player)
            // Save stats (but not stack - stack stays at table for next hand)
            await this.dataHandler.updateUserData(player.id, this.dataHandler.resolveDBUser(player))
        }

        this.SendMessage("showFinalResults")
        this.UpdateInGame()
        await sleep(4500)
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

    async RemovePlayer(player) {
        const playerId = typeof player === "object" ? player?.id : player
        if (!playerId) return
        const existing = this.GetPlayer(playerId)
        if (!existing) return

        // Return stack to bankroll before removing player
        if (existing.stack > 0) {
            bankrollManager.syncStackToBankroll(existing)
            await this.dataHandler.updateUserData(existing.id, this.dataHandler.resolveDBUser(existing))
        }

        const index = this.players.indexOf(existing)
        if (index !== -1) this.players.splice(index, 1)
        // playerRemoved message removed - lobby will handle the update
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
        // Stop the action collector to prevent duplicates in next round
        if (this.collector) {
            this.collector.stop()
            this.collector = null
        }

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

        // Sync all stacks to bankroll before stopping
        for (const player of this.players) {
            if (player.stack > 0) {
                bankrollManager.syncStackToBankroll(player)
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
        }

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
