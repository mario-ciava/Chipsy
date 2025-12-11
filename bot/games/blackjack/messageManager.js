const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js")
const setSeparator = require("../../../shared/utils/setSeparator")
const { buildProbabilityField } = require("../../utils/probabilityFormatter")
const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
const logger = require("../../../shared/logger")
const config = require("../../../config")
const { sleep } = require("../../utils/helpers")
const {
    EMPTY_TIMELINE_TEXT,
    resolvePlayerLabel,
    formatPlayerName,
    formatTimeout,
    resolvePlayerStackDisplay
} = require("../shared/messageHelpers")

const CARD_VALUE_MAP = {
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    T: "10",
    9: "9",
    8: "8",
    7: "7",
    6: "6",
    5: "5",
    4: "4",
    3: "3",
    2: "2"
}

const CARD_SUIT_MAP = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
}

const PROBABILITY_WAIT_TIMEOUT_MS = 1200

function formatCardLabel(cardCode) {
    if (!cardCode || typeof cardCode !== "string") return cardCode ?? ""
    const value = CARD_VALUE_MAP[cardCode[0]] ?? cardCode[0]
    const suit = CARD_SUIT_MAP[cardCode[1]] ?? cardCode[1] ?? ""
    return `${value}${suit}`
}

function buildActionButtons(playerId, options) {
    if (!Array.isArray(options) || options.length === 0) return null
    const ACTION_BUTTONS = {
        stand: { label: "Stand", style: ButtonStyle.Secondary, emoji: "🛑" },
        hit: { label: "Hit", style: ButtonStyle.Primary, emoji: "🎯" },
        double: { label: "Double", style: ButtonStyle.Success, emoji: "💰" },
        split: { label: "Split", style: ButtonStyle.Success, emoji: "✂️" },
        insurance: { label: "Insurance", style: ButtonStyle.Danger, emoji: "🛡️" }
    }

    const row = new ActionRowBuilder()
    for (const option of options) {
        const meta = ACTION_BUTTONS[option]
        if (!meta) continue
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`bj_action:${option}:${playerId}`)
                .setLabel(meta.label)
                .setStyle(meta.style)
                .setEmoji(meta.emoji)
        )
    }
    return row.components.length > 0 ? row : null
}

function formatHandSummary(hand, options = {}) {
    const {
        isCurrent = false,
        showPointer = true,
        includeHandLabel = false,
        handIndex = null
    } = options
    const statusParts = [Number.isFinite(hand?.value) ? `${hand.value}` : "??"]
    if (hand?.busted) statusParts.push("Busted")
    if (hand?.BJ) statusParts.push("Blackjack")
    if (hand?.push) statusParts.push("Push")
    const pointer = isCurrent && showPointer ? "▶ " : ""
    const handLabel = includeHandLabel
        ? `Hand #${Number.isInteger(handIndex) ? handIndex + 1 : "?"} • `
        : ""
    return `${pointer}${handLabel}${statusParts.join(" • ")}`
}

class BlackjackMessageManager {
    constructor(game) {
        this.game = game
    }

    async SendMessage(type, player, info) {
        const { game } = this
        const clientAvatar = game.client?.user?.displayAvatarURL({ extension: "png" }) ?? null
        const sendEmbed = async(embed, components = [], additionalPayload = {}) => {
            try {
                const payload = { embeds: [embed], ...additionalPayload }
                if (components.length > 0) {
                    payload.components = components
                }
                return await game.broadcaster.broadcast(payload)
            } catch (error) {
                logger.error("Failed to send blackjack message", {
                    scope: "blackjackGame",
                    type,
                    channelId: game.channel?.id,
                    userId: player?.id,
                    error: error.message,
                    stack: error.stack
                })
                return null
            }
        }

        switch(type) {
        case "deckRestored": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Aqua)
                .setFooter({ text: "Game deck has been shuffled and restored", iconURL: clientAvatar })
            await sendEmbed(embed)
            break }
        case "maxPlayers": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
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
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({ text: message })
            await sendEmbed(embed)
            break }
        case "stand":
        case "hit": {
            const cardLabel = info?.card ? ` (${formatCardLabel(info.card)})` : ""
            const handLabel = typeof info?.handIndex === "number" && player?.hands?.length > 1
                ? ` (Hand #${info.handIndex + 1})`
                : ""
            const embed = new EmbedBuilder()
                .setColor(type === "hit" ? Colors.Purple : Colors.LuminousVividPink)
                .setFooter({
                    text: `${player.tag} ${type === "hit" ? "hit" : "stand"}s${cardLabel}`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} ${type === "hit" ? `hits${cardLabel}` : "stands"}.`)
            break }
        case "double": {
            const cardLabel = info?.card ? ` (${formatCardLabel(info.card)})` : ""
            const handLabel = typeof info?.handIndex === "number" && player?.hands?.length > 1
                ? ` (Hand #${info.handIndex + 1})`
                : ""
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${player.tag} doubles (-${setSeparator(player.bets.initial)}$)${cardLabel}`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} doubles bet${cardLabel}.`)
            break }
        case "split": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Aqua)
                .setFooter({
                    text: `${player.tag} splits hand (-${setSeparator(player.bets.initial)}$)`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)} splits hand.`)
            break }
        case "insurance": {
            const insuranceValue = Math.max(0, Number(info?.amount ?? player?.bets?.insurance ?? 0))
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${player.tag} has bought insurance (-${setSeparator(insuranceValue)}$)`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)} buys insurance (${setSeparator(insuranceValue)}$).`)
            break }
        case "insuranceRefund": {
            const payout = Math.max(0, Number(info?.payout ?? 0))
            const embed = new EmbedBuilder()
                .setColor(Colors.Green)
                .setFooter({
                    text: `${player.tag} has been refunded due to insurance (+${setSeparator(payout)}$)`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)} receives insurance payout (+${setSeparator(payout)}$).`)
            break }
        case "invalidBet": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({
                    text: `${player.tag}, invalid bet amount provided.`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            break }
        case "betLocked": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({
                    text: `${player.tag}, you have already placed your bet for this round.`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            break }
        case "dealerHit":
        case "dealerStand": {
            game.appendDealerTimeline(`**Dealer** ${type === "dealerHit" ? "hits" : "stands"}.`)
            break }
        case "dealerBusted": {
            game.appendDealerTimeline("**Dealer** busted.")
            break }
        case "showDealer": {
            game.appendDealerTimeline(`**Dealer** reveals hidden card`)
            const message = await game.updateDealerProgressEmbed()
            game.dealerStatusMessage = message
            return message
        }
        case "showStartingCards": {
            game.clearDealerTimeline()
            game.appendDealerTimeline(`Round #${game.hands} started. Dealing opening cards.`)
            await game.updateDealerProgressEmbed()
            break }
        case "displayInfo": {
            const pointerEnabled = !info
            const handSummary = player.hands.map((hand, idx) =>
                formatHandSummary(hand, {
                    isCurrent: idx === player.status.currentHand,
                    showPointer: pointerEnabled
                })
            ).join("\n") || "No cards drawn yet."

            const embed = new EmbedBuilder()
                .setColor(Colors.Gold)
                .setTitle(`${player.tag} — Hand status`)
                .setDescription([
                    handSummary,
                    info ? "*Standing automatically*" : null
                ].filter(Boolean).join("\n\n"))
                .setFooter({
                    text: `Total bet: ${setSeparator(player.bets.total)}$ | Insurance: ${player.bets.insurance > 0 ? setSeparator(player.bets.insurance) + "$" : "no"} | ${Math.round(game.actionTimeoutMs / 1000)}s left`,
                    iconURL: clientAvatar
                })

            const components = []
            if (!info) {
                const actionRow = buildActionButtons(player.id, player.availableOptions)
                if (actionRow) components.push(actionRow)
            }

            const payload = {}
            const snapshot = await game.captureTableRender({
                filename: `blackjack_round_${game.hands}_info_${player.id}_${Date.now()}.png`,
                description: `Snapshot for ${player.tag} during round ${game.hands}`,
                hideDealerHoleCard: true,
                maskDealerValue: true,
                forceResult: null
            })
            if (snapshot) {
                embed.setImage(`attachment://${snapshot.filename}`)
                payload.files = [snapshot.attachment]
            }

            const existingMessage = player.status?.infoMessage
            const payloadWithEmbed = { ...payload, embeds: [embed], components }

            if (existingMessage && typeof existingMessage.edit === "function") {
                player.status.infoMessage = await existingMessage.edit(payloadWithEmbed).catch(() => existingMessage)
            } else if (game.channel && typeof game.channel.send === "function") {
                player.status.infoMessage = await game.channel.send(payloadWithEmbed)
            }
            return player.status.infoMessage
        }
        case "betsOpened": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Green)
                .setTitle(`Bets opened | Round #${game.hands}`)
                .setDescription("Click **Bet** to place your bet, or **Leave** to exit the game.")
                .addFields({
                    name: "Available stacks",
                    value: `${game.players
                        .filter((p) => !p.newEntry)
                        .map((p) => `${p} - Stack: ${setSeparator(resolvePlayerStackDisplay(p))}$`)
                        .join("\n") || "-"}`
                })
                .setFooter({ text: `You have got ${formatTimeout(config.blackjack.betsTimeout.default)}${game.getDeckWarning()}` })

            const components = [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("bj_bet:place")
                        .setLabel("Bet")
                        .setStyle(ButtonStyle.Success)
                        .setEmoji("💰"),
                    new ButtonBuilder()
                        .setCustomId("bj_bet:autobet")
                        .setLabel("Autobet")
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji("🔄"),
                    new ButtonBuilder()
                        .setCustomId("bj_bet:leave")
                        .setLabel("Leave")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🚪")
                )
            ]

            return await sendEmbed(embed, components)
        }
        case "betsUpdated": {
            if (!player) break
            const embed = new EmbedBuilder()
                .setColor(Colors.Green)
                .setFooter({
                    text: `${player.tag} placed a bet of ${setSeparator(player.bets.initial)}$`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            break }
        case "removeBet": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${player.tag} canceled their bet`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            break }
        case "betsClosed": {
            const participatingPlayers = game.players.filter((p) => p?.bets?.initial > 0 && !p.status?.removed)
            const summary = game.partitionBettingPlayers(participatingPlayers)
            const hasRequiredPlayers = participatingPlayers.length >= game.getMinimumPlayers()
            const missing = Math.max(0, game.getMinimumPlayers() - participatingPlayers.length)
            const embed = new EmbedBuilder()
                .setColor(hasRequiredPlayers ? Colors.Green : Colors.Red)
                .setTitle(hasRequiredPlayers ? "✅ Bets locked" : "⏳ Waiting for more bets")
                .setDescription(hasRequiredPlayers
                    ? `Round #${game.hands} will start now.`
                    : `Need ${missing} more bet${missing === 1 ? "" : "s"} to start.`)
                .addFields(
                    {
                        name: "Players",
                        value: summary.withBets.length ? summary.withBets.join("\n") : "—",
                        inline: false
                    }
                )
            return await sendEmbed(embed)
        }
        case "noMoneyBet": {
            if (!player) break
            const embed = new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({
                    text: `${player.tag}, you can not afford to bet this amount of money`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            break }
        case "deckLow": {
            const remaining = Math.max(0, (game.cards || []).length)
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({ text: `Deck is low (${remaining} cards remaining). Will reshuffle soon.`, iconURL: clientAvatar })
            await sendEmbed(embed)
            break }
        case "blackjack": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Gold)
                .setFooter({
                    text: `${player.tag} hits blackjack! 🎉`,
                    iconURL: player.displayAvatarURL({ extension: "png" })
                })
            await sendEmbed(embed)
            game.appendDealerTimeline(`${formatPlayerName(player)} hits blackjack! 🎉`)
            break }
        case "insuranceOffered": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({ text: "Insurance offered. Click a button to buy or skip.", iconURL: clientAvatar })
                .setTitle("Insurance Offer")
                .setDescription("Dealer shows an Ace. Do you want to buy insurance?")
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId("bj_insurance:buy").setLabel("Buy insurance").setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId("bj_insurance:skip").setLabel("Skip").setStyle(ButtonStyle.Secondary)
                )
            return await sendEmbed(embed, [row])
        }
        case "insuranceClosed": {
            const embed = new EmbedBuilder()
                .setColor(Colors.DarkGrey)
                .setFooter({ text: "Insurance window closed.", iconURL: clientAvatar })
            await sendEmbed(embed)
            break }
        case "insuranceResult": {
            const embed = new EmbedBuilder()
                .setColor(info?.dealerHasBlackjack ? Colors.Red : Colors.Green)
                .setFooter({
                    text: info?.dealerHasBlackjack
                        ? "Dealer had blackjack. Insurance paid out."
                        : "Dealer did not have blackjack. Insurance lost.",
                    iconURL: clientAvatar
                })
            await sendEmbed(embed)
            break }
        case "autobetSetup": {
            const { user, preset } = info || {}
            const embed = new EmbedBuilder()
                .setColor(Colors.Aqua)
                .setTitle("Autobet configured")
                .setDescription(`${user?.tag || "Player"} configured autobet.`)
                .addFields(
                    {
                        name: "Rounds",
                        value: preset?.rounds ? preset.rounds.toString() : "—",
                        inline: true
                    },
                    {
                        name: "Bet",
                        value: preset?.bet ? `${setSeparator(preset.bet)}$` : "—",
                        inline: true
                    }
                )
            return await sendEmbed(embed)
        }
        case "rebuyOffered": {
            const embed = new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: "You busted. Click Rebuy to stay in the game.",
                    iconURL: clientAvatar
                })
                .setTitle("Rebuy available")
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId("bj_rebuy:accept").setLabel("Rebuy").setStyle(ButtonStyle.Primary)
                )
            return await sendEmbed(embed, [row])
        }
        case "rebuyExpired": {
            const embed = new EmbedBuilder()
                .setColor(Colors.DarkGrey)
                .setFooter({
                    text: "Rebuy window expired. You have left the game.",
                    iconURL: clientAvatar
                })
            await sendEmbed(embed)
            break }
        default:
            break
        }
        return null
    }

    async updateRoundProgressEmbed(player, autoStanding = false, renderOptions = {}) {
        const { game } = this
        try {
            const paused = Boolean(renderOptions?.paused || (game.isRemotePauseActive && game.isRemotePauseActive()))
            await this.waitForProbabilitySnapshot(player, renderOptions)
            const handSummary = player.hands.map((hand, idx) =>
                formatHandSummary(hand, {
                    isCurrent: idx === player.status.currentHand,
                    includeHandLabel: true,
                    handIndex: idx
                })
            ).join("\n") || "—"
            const timelineText = game.buildDealerTimelineDescription() ?? EMPTY_TIMELINE_TEXT

            const embed = new EmbedBuilder()
                .setColor(paused ? Colors.DarkGrey : Colors.Gold)
                .setTitle(`${player.tag}'s turn`)
                .setDescription(paused
                    ? `⏸️ Tavolo in pausa dagli admin.\n\n${timelineText}`
                    : timelineText)
                .addFields(
                    { name: "Hands", value: handSummary, inline: false }
                )

            if (hasWinProbabilityInsight(player)) {
                const probabilityTitle = `🔮 Outcome probability for ${resolvePlayerLabel(player)}`
                const probabilityField = buildProbabilityField({
                    win: player.status?.winProbability,
                    tie: player.status?.pushProbability,
                    lose: player.status?.lossProbability
                }, {
                    title: probabilityTitle,
                    tieLabel: "🟠 Push"
                }) || {
                    name: probabilityTitle,
                    value: "Calculating...",
                    inline: false
                }
                embed.addFields(probabilityField)
            }

            const components = []
            if (!autoStanding && !paused) {
                const actionRow = buildActionButtons(player.id, player.availableOptions)
                if (actionRow) components.push(actionRow)
            }

            if (!paused && player.autobet && player.autobet.remaining > 0) {
                const autobetRow = new ActionRowBuilder()
                autobetRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId("bj_disable_autobet")
                        .setLabel("Disable Autobet")
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji("🛑")
                )
                components.push(autobetRow)
            }

            const forceInactivePlayerId = renderOptions?.forceInactivePlayerId
            const forceCurrentHandIndex = renderOptions?.forceCurrentHandIndex
            let renderPlayers = game.inGamePlayers

            if (forceInactivePlayerId || (typeof forceCurrentHandIndex === "number" && !Number.isNaN(forceCurrentHandIndex))) {
                renderPlayers = game.inGamePlayers.map((tablePlayer) => {
                    const isTarget = tablePlayer?.id === player.id
                    const shouldForceInactive = forceInactivePlayerId && tablePlayer?.id === forceInactivePlayerId
                    const shouldForceHand = isTarget && typeof forceCurrentHandIndex === "number" && !Number.isNaN(forceCurrentHandIndex)

                    if (!shouldForceInactive && !shouldForceHand) {
                        return tablePlayer
                    }

                    const statusClone = { ...(tablePlayer.status || {}) }
                    if (shouldForceInactive) {
                        statusClone.current = false
                    }
                    if (shouldForceHand) {
                        statusClone.currentHand = forceCurrentHandIndex
                    }
                    return {
                        ...tablePlayer,
                        status: statusClone
                    }
                })
            }

            const snapshot = await game.captureTableRender({
                filename: `blackjack_round_${game.hands}_progress_${Date.now()}.png`,
                description: `Round progress snapshot for ${player.tag}`,
                hideDealerHoleCard: true,
                maskDealerValue: true,
                forceResult: null,
                players: renderPlayers
            })

            const payload = {
                embeds: [embed],
                components
            }

            if (snapshot) {
                embed.setImage(`attachment://${snapshot.filename}`)
                payload.files = [snapshot.attachment]
                payload.attachments = []
            }

            const message = await game.broadcaster.broadcast(payload)
            if (message) {
                game.roundProgressMessage = message
                game.lastRoundMessage = message
            } else {
                game.roundProgressMessage = game.roundProgressMessage || null
            }
        } catch (error) {
            logger.error("Failed to update round progress embed", {
                scope: "blackjackGame",
                playerId: player?.id,
                error: error.message
            })
        }
    }

    async updateDealerProgressEmbed(isFinal = false) {
        const { game } = this
        try {
            const timelineText = game.buildDealerTimelineDescription()

            const embed = new EmbedBuilder()
                .setColor(isFinal ? Colors.Blue : Colors.Purple)
                .setTitle(isFinal ? "Round Results" : "Table Timeline")
                .setDescription(timelineText ?? EMPTY_TIMELINE_TEXT)

            const snapshot = await game.captureTableRender({
                filename: `blackjack_round_${game.hands}_dealer_${Date.now()}.png`,
                description: `Dealer ${isFinal ? "final" : "turn"} snapshot for round ${game.hands}`,
                hideDealerHoleCard: false,
                maskDealerValue: false,
                forceResult: null
            })

            const payload = {
                embeds: [embed],
                components: []
            }

            if (snapshot) {
                embed.setImage(`attachment://${snapshot.filename}`)
                payload.files = [snapshot.attachment]
                payload.attachments = []
            }

            const message = await game.broadcaster.broadcast(payload)
            if (message) {
                game.roundProgressMessage = message
                game.lastRoundMessage = message
                game.dealerStatusMessage = message
            } else {
                game.roundProgressMessage = game.roundProgressMessage || null
            }
        } catch (error) {
            logger.error("Failed to update dealer progress embed", {
                scope: "blackjackGame",
                error: error.message
            })
        }
    }

    async waitForProbabilitySnapshot(player, renderOptions = {}) {
        if (renderOptions?.probabilityRefresh) return
        if (!hasWinProbabilityInsight(player)) return
        const pending = this.game?.pendingProbabilityTask
        if (!pending || typeof pending.then !== "function") return
        try {
            await Promise.race([pending, sleep(PROBABILITY_WAIT_TIMEOUT_MS)])
        } catch (error) {
            logger.debug("Probability wait interrupted", {
                scope: "blackjackGame",
                playerId: player?.id,
                error: error?.message
            })
        }
    }
}

module.exports = {
    BlackjackMessageManager,
    buildActionButtons,
    formatHandSummary
}
