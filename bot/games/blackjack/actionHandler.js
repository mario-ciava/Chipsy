const HandEvaluator = require("./handEvaluator")
const SplitManager = require("./splitManager")
const InsuranceManager = require("./insuranceManager")
const bankrollManager = require("../../utils/bankrollManager")
const { sleep } = require("../../utils/helpers")
const config = require("../../../config")

const CARD_VALUE_MAP = {
    A: "A", K: "K", Q: "Q", J: "J", T: "10",
    9: "9", 8: "8", 7: "7", 6: "6", 5: "5", 4: "4", 3: "3", 2: "2"
}

const CARD_SUIT_MAP = {
    S: "♠", H: "♥", D: "♦", C: "♣"
}

function formatCardLabel(cardCode) {
    if (!cardCode || typeof cardCode !== "string") return cardCode ?? ""
    const value = CARD_VALUE_MAP[cardCode[0]] ?? cardCode[0]
    const suit = CARD_SUIT_MAP[cardCode[1]] ?? cardCode[1] ?? ""
    return `${value}${suit}`
}

function formatPlayerName(player) {
    const label = player?.tag || player?.username || player?.name || "Player"
    return `**${label}**`
}

/**
 * ActionHandler
 *
 * Handles player actions during blackjack gameplay (hit, stand, double, split, insurance).
 */
class ActionHandler {
    constructor(game) {
        this.game = game
        this.splitManager = new SplitManager(game)
        this.insuranceManager = new InsuranceManager(game)
    }

    /**
     * Determines available actions for a player's current hand.
     *
     * @param {Object} player
     * @param {number} handIndex
     * @returns {Promise<string[]>} Array of available action names
     */
    async getAvailableActions(player, handIndex) {
        await this.game.ComputeHandsValue(player)

        const available = []
        const hand = player.hands[handIndex]

        // Stand is always available
        available.push("stand")

        // If this is a split ace hand with 2 cards, only stand is available
        const isSplitAceHand = SplitManager.isSplitAceHand(hand)
        if (isSplitAceHand) return available

        // Hit is available
        available.push("hit")

        // Double down available on first 2 cards if player can afford
        const canAffordBaseBet = bankrollManager.canAffordStack(player, player.bets?.initial)
        if (hand.cards.length < 3 && canAffordBaseBet) {
            available.push("double")
        }

        // Split available if hand is a pair and player can afford
        if (this.splitManager.canSplit(player, handIndex)) {
            available.push("split")
        }

        // Insurance available if dealer shows Ace and player hasn't taken it yet
        if (this.insuranceManager.canPlayerTakeInsurance(player, hand)) {
            available.push("insurance")
        }

        return available
    }

    /**
     * Processes a player action.
     *
     * @param {string} action - Action type (hit, stand, double, split, insurance)
     * @param {Object} player
     * @param {number} handIndex
     * @param {boolean} automatic - If true, action triggered automatically (e.g., timeout)
     * @returns {Promise<Object>} { success: boolean, actionEndsHand: boolean, shouldUpdateEmbed: boolean }
     */
    async processAction(action, player, handIndex, automatic = false) {
        const hand = player.hands[handIndex]

        if (!player.availableOptions.includes(action) && !automatic) {
            return { success: false, reason: "actionNotAvailable" }
        }

        // Prevent race condition
        if (player.status?.actionInProgress) {
            return { success: false, reason: "actionInProgress" }
        }

        player.status.actionInProgress = true

        // Clear timer
        if (this.game.timer) {
            clearTimeout(this.game.timer)
            this.game.timer = null
        }

        await this.game.ComputeHandsValue(player)

        let shouldUpdateEmbed = false
        let actionEndsHand = false
        let result = { success: true }

        try {
            switch (action) {
                case "stand":
                    result = await this.handleStand(player, handIndex, hand)
                    shouldUpdateEmbed = result.shouldUpdateEmbed
                    actionEndsHand = result.actionEndsHand
                    break

                case "hit":
                    result = await this.handleHit(player, handIndex, hand)
                    shouldUpdateEmbed = result.shouldUpdateEmbed
                    actionEndsHand = result.actionEndsHand
                    // Hit doesn't end hand unless busted
                    if (!result.busted) {
                        player.status.actionInProgress = false
                        return { success: true, continueHand: true }
                    }
                    break

                case "double":
                    result = await this.handleDouble(player, handIndex, hand)
                    shouldUpdateEmbed = result.shouldUpdateEmbed
                    actionEndsHand = result.actionEndsHand
                    if (!result.busted) {
                        player.status.actionInProgress = false
                        return { success: true, actionEndsHand: true, shouldUpdateEmbed: true }
                    }
                    break

                case "split":
                    result = await this.handleSplit(player, handIndex)
                    player.status.actionInProgress = false
                    return { success: true, continueHand: true, shouldUpdateEmbed: true }

                case "insurance":
                    result = await this.handleInsurance(player, handIndex)
                    player.status.actionInProgress = false
                    return { success: true, continueHand: true, shouldUpdateEmbed: true, insuranceTaken: true }

                default:
                    player.status.actionInProgress = false
                    return { success: false, reason: "unknownAction" }
            }
        } finally {
            this.game.queueProbabilityUpdate("playerAction")
        }

        // Post-action handling
        await this.game.ComputeHandsValue(player)

        if (hand.busted) {
            const handLabel = player.hands.length > 1 ? ` (Hand #${handIndex + 1})` : ""
            this.game.appendDealerTimeline(`${formatPlayerName(player)} busts${handLabel}.`)
            hand.locked = true
            shouldUpdateEmbed = true
            actionEndsHand = true
            await sleep(config.delays.medium.default)
        }

        player.status.actionInProgress = false

        return {
            success: true,
            shouldUpdateEmbed,
            actionEndsHand,
            busted: hand.busted
        }
    }

    async handleStand(player, handIndex, hand) {
        const handLabel = player.hands.length > 1 ? ` (Hand #${handIndex + 1})` : ""
        this.game.appendDealerTimeline(`${formatPlayerName(player)}${handLabel} stands.`)
        hand.locked = true
        return { shouldUpdateEmbed: true, actionEndsHand: true }
    }

    async handleHit(player, handIndex, hand) {
        const newCard = await this.game.PickRandom(this.game.cards, 1)
        hand.cards = hand.cards.concat(newCard)
        await this.game.ComputeHandsValue(player)

        const handLabel = player.hands.length > 1 ? ` (Hand #${handIndex + 1})` : ""
        this.game.appendDealerTimeline(
            `${formatPlayerName(player)}${handLabel} hits (${formatCardLabel(newCard[0])}).`
        )

        return {
            shouldUpdateEmbed: true,
            actionEndsHand: false,
            busted: hand.busted
        }
    }

    async handleDouble(player, handIndex, hand) {
        const additionalBet = Number.isFinite(player.bets?.initial) ? player.bets.initial : 0

        if (additionalBet < 1 || !bankrollManager.canAffordStack(player, additionalBet)) {
            await this.game.SendMessage("noMoneyBet", player)
            return { shouldUpdateEmbed: false, actionEndsHand: false, insufficientFunds: true }
        }

        const newCard = await this.game.PickRandom(this.game.cards, 1)
        hand.cards = hand.cards.concat(newCard)

        if (!bankrollManager.withdrawStackOnly(player, additionalBet)) {
            await this.game.SendMessage("noMoneyBet", player)
            return { shouldUpdateEmbed: false, actionEndsHand: false, insufficientFunds: true }
        }

        player.bets.total += additionalBet
        hand.bet += additionalBet

        await this.game.ComputeHandsValue(player)

        hand.locked = true
        hand.doubleDown = true

        const handLabel = player.hands.length > 1 ? ` (Hand #${handIndex + 1})` : ""
        this.game.appendDealerTimeline(
            `${formatPlayerName(player)}${handLabel} doubles bet (${formatCardLabel(newCard[0])}).`
        )

        return {
            shouldUpdateEmbed: true,
            actionEndsHand: true,
            busted: hand.busted
        }
    }

    async handleSplit(player, handIndex) {
        const result = await this.splitManager.performSplit(player, handIndex, formatPlayerName)

        if (!result.success) {
            if (result.reason === "insufficientFunds") {
                await this.game.SendMessage("noMoneyBet", player)
            }
            return { success: false, reason: result.reason }
        }

        return { success: true, shouldUpdateEmbed: true }
    }

    async handleInsurance(player, handIndex) {
        const result = this.insuranceManager.processInsurancePurchase(player, formatPlayerName)

        if (!result.success) {
            if (result.insufficientFunds) {
                await this.game.SendMessage("noMoneyBet", player)
            }
            return { success: false }
        }

        // Recalculate available options (insurance removed after purchase)
        player.availableOptions = await this.getAvailableActions(player, handIndex)

        return { success: true, shouldUpdateEmbed: true, insuranceAmount: result.insuranceAmount }
    }
}

module.exports = ActionHandler
