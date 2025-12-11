const HandEvaluator = require("./handEvaluator")
const bankrollManager = require("../../utils/bankrollManager")

/**
 * SplitManager
 *
 * Manages hand splitting in blackjack. When a player has a pair (two cards of same rank),
 * they can split into two separate hands with additional bet.
 */
class SplitManager {
    constructor(game) {
        this.game = game
    }

    /**
     * Checks if a player can split their current hand.
     *
     * @param {Object} player
     * @param {number} handIndex - Index of hand to split
     * @param {number} maxHands - Maximum allowed hands (default 4)
     * @returns {boolean}
     */
    canSplit(player, handIndex, maxHands = 4) {
        if (!player || !Array.isArray(player.hands)) return false
        if (player.hands.length >= maxHands) return false

        const hand = player.hands[handIndex]
        if (!hand) return false

        // Must be a pair
        if (!HandEvaluator.isPair(hand)) return false

        // Must be able to afford the split cost (same as initial bet)
        const splitCost = Number(player.bets?.initial) || 0
        if (splitCost < 1) return false

        return bankrollManager.canAffordStack(player, splitCost)
    }

    /**
     * Performs a split operation on a player's hand.
     * Splits the pair into two hands, each with one card from the pair plus a new card.
     *
     * @param {Object} player
     * @param {number} handIndex - Index of hand to split
     * @param {Function} formatPlayerName - Function to format player name for timeline
     * @returns {Promise<Object>} { success: boolean, newHandIndex: number }
     */
    async performSplit(player, handIndex, formatPlayerName) {
        if (!this.canSplit(player, handIndex)) {
            return { success: false, reason: "cannotSplit" }
        }

        const splitCost = Number(player.bets?.initial) || 0
        const currentHand = player.hands[handIndex]

        // Withdraw the split cost
        if (!bankrollManager.withdrawStackOnly(player, splitCost)) {
            return { success: false, reason: "insufficientFunds" }
        }

        // Remove second card from current hand
        const removedCard = currentHand.cards.splice(1, 1)

        // Reset pair flag
        currentHand.pair = false

        // Check if splitting aces (special rules: only 1 card each, can't hit further)
        const splitAce = currentHand.cards[0].split("")[0] === "A"
        currentHand.fromSplitAce = splitAce

        // Create new hand with the removed card + new card
        const newHand = {
            cards: removedCard.concat(await this.game.PickRandom(this.game.cards, 1)),
            value: 0,
            pair: false,
            busted: false,
            BJ: false,
            push: false,
            bet: player.bets.initial,
            display: [],
            fromSplitAce: splitAce,
            result: null,
            payout: 0,
            locked: false,
            doubleDown: false
        }

        player.hands.push(newHand)

        // Add new card to current hand
        currentHand.cards = await currentHand.cards.concat(
            await this.game.PickRandom(this.game.cards, 1)
        )

        // Update total bet amount
        player.bets.total += splitCost

        // Re-evaluate hands
        await this.game.ComputeHandsValue(player)

        // Log to timeline
        const playerName = typeof formatPlayerName === "function"
            ? formatPlayerName(player)
            : player.tag || player.username || "Player"

        this.game.appendDealerTimeline(`${playerName} splits hand.`)

        return {
            success: true,
            newHandIndex: player.hands.length - 1,
            splitAce
        }
    }

    /**
     * Checks if a hand is from splitting aces (special rules apply).
     *
     * @param {Object} hand
     * @returns {boolean}
     */
    static isSplitAceHand(hand) {
        return Boolean(hand?.fromSplitAce && hand?.cards?.length >= 2)
    }

    /**
     * Gets the active hand index for a player.
     *
     * @param {Object} player
     * @returns {number} Current hand index
     */
    getActiveHandIndex(player) {
        return Number(player.status?.currentHand) || 0
    }

    /**
     * Checks if player has more hands to play after current one.
     *
     * @param {Object} player
     * @param {number} currentHandIndex
     * @returns {boolean}
     */
    hasMoreHands(player, currentHandIndex) {
        if (!player || !Array.isArray(player.hands)) return false
        return currentHandIndex + 1 < player.hands.length
    }

    /**
     * Advances to the next hand for a player with multiple hands.
     *
     * @param {Object} player
     * @returns {number|null} Next hand index or null if no more hands
     */
    advanceToNextHand(player) {
        if (!player.status) player.status = {}
        const currentHandIndex = this.getActiveHandIndex(player)

        if (this.hasMoreHands(player, currentHandIndex)) {
            player.status.currentHand = currentHandIndex + 1
            return player.status.currentHand
        }

        return null
    }
}

module.exports = SplitManager
