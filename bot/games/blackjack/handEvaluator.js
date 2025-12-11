/**
 * HandEvaluator
 *
 * Static utility class for blackjack hand evaluation logic.
 * Handles card value calculation, blackjack detection, bust detection,
 * and hand comparison for determining winners.
 */
class HandEvaluator {
    /**
     * Evaluates a hand and updates its properties (value, BJ, busted, pair).
     *
     * @param {Object} hand - Hand object with cards array
     * @param {Object} options - Optional configuration
     * @param {boolean} options.isPlayerHand - True if this is a player's hand (affects BJ detection)
     * @param {number} options.playerHandCount - Number of hands player has (affects BJ detection)
     * @returns {Object} Updated hand object
     */
    static evaluateHand(hand, options = {}) {
        if (!hand || !Array.isArray(hand.cards)) {
            throw new Error("Invalid hand: missing cards array")
        }

        const { isPlayerHand = true, playerHandCount = 1 } = options

        // Count aces
        let aces = hand.cards.filter((card) => {
            return card.split("")[0] === "A"
        }).length

        hand.value = 0

        // Check for pair (only if exactly 2 cards and not already marked)
        if (hand.cards.length === 2 && !hand.pair) {
            const firstCard = hand.cards[0].split("")[0]
            const secondCard = hand.cards[1].split("")[0]
            if (firstCard === secondCard) {
                hand.pair = true
            }
        }

        // Check for blackjack (21 on first 2 cards with Ace + 10-value)
        // Only valid if: 2 cards, not a pair, has 1 ace, player has only 1 hand (no splits)
        if (!hand.pair && hand.cards.length === 2 && aces === 1 && (isPlayerHand ? playerHandCount < 2 : true)) {
            const hasTenValue = hand.cards.some((card) => {
                return ["K", "Q", "J", "T"].includes(card.split("")[0])
            })
            if (hasTenValue) {
                hand.BJ = true
            }
        }

        // Calculate hand value
        for (let card of hand.cards) {
            const rank = card.split("")[0]
            const val = parseInt(rank, 10)

            if (!isNaN(val)) {
                hand.value += val
            } else if (rank === "A") {
                hand.value += 11
            } else {
                // K, Q, J, T
                hand.value += 10
            }
        }

        // Adjust for aces (convert from 11 to 1 if needed)
        while (hand.value > 21 && aces > 0) {
            hand.value -= 10
            aces--
        }

        // Mark as busted if over 21
        hand.busted = hand.value > 21

        return hand
    }

    /**
     * Checks if a hand is a blackjack (21 on first 2 cards).
     *
     * @param {Object} hand - Hand object
     * @returns {boolean}
     */
    static isBlackjack(hand) {
        return Boolean(hand?.BJ)
    }

    /**
     * Checks if a hand is busted (value > 21).
     *
     * @param {Object} hand - Hand object
     * @returns {boolean}
     */
    static isBust(hand) {
        return Boolean(hand?.busted)
    }

    /**
     * Gets the numerical value of a hand.
     *
     * @param {Object} hand - Hand object
     * @returns {number}
     */
    static getHandValue(hand) {
        return Number(hand?.value) || 0
    }

    /**
     * Checks if a hand is a pair (first 2 cards same rank).
     *
     * @param {Object} hand - Hand object
     * @returns {boolean}
     */
    static isPair(hand) {
        if (!hand || !Array.isArray(hand.cards) || hand.cards.length !== 2) {
            return false
        }
        const firstRank = hand.cards[0].split("")[0]
        const secondRank = hand.cards[1].split("")[0]
        return firstRank === secondRank
    }

    /**
     * Determines the result of a player hand vs dealer hand.
     *
     * @param {Object} playerHand - Player's hand
     * @param {Object} dealerHand - Dealer's hand
     * @returns {Object} { result: "win"|"lose"|"push", winFactor: number }
     */
    static compareHands(playerHand, dealerHand) {
        // Player busted always loses
        if (playerHand.busted) {
            return { result: "lose", winFactor: 0 }
        }

        // Dealer busted - player wins
        if (dealerHand.busted) {
            const winFactor = playerHand.BJ ? 2.5 : 2
            return { result: "win", winFactor }
        }

        // Both standing - compare values
        if (playerHand.value < dealerHand.value) {
            return { result: "lose", winFactor: 0 }
        } else if (playerHand.value === dealerHand.value) {
            return { result: "push", winFactor: 1 }
        } else {
            // Player wins
            const winFactor = playerHand.BJ ? 2.5 : 2
            return { result: "win", winFactor }
        }
    }

    /**
     * Calculates the payout for a hand based on result and win factor.
     *
     * @param {number} betAmount - Original bet amount
     * @param {string} result - "win", "lose", or "push"
     * @param {number} winFactor - Multiplier for winnings (2 for normal win, 2.5 for BJ, 1 for push)
     * @returns {number} Payout amount (positive for win, negative for loss, 0 for push)
     */
    static calculatePayout(betAmount, result, winFactor) {
        if (result === "lose") {
            return -betAmount
        } else if (result === "push") {
            return 0
        } else if (result === "win") {
            // Payout is (bet * winFactor) - bet
            // For normal win: (100 * 2) - 100 = 100
            // For BJ: (100 * 2.5) - 100 = 150
            return (betAmount * winFactor) - betAmount
        }
        return 0
    }

    /**
     * Checks if a hand can be split (is a pair).
     *
     * @param {Object} hand - Hand object
     * @param {number} currentHandCount - Number of hands player currently has
     * @param {number} maxHands - Maximum allowed hands (default 4)
     * @returns {boolean}
     */
    static canSplit(hand, currentHandCount, maxHands = 4) {
        if (!hand || currentHandCount >= maxHands) {
            return false
        }
        return this.isPair(hand)
    }

    /**
     * Checks if dealer should hit (dealer rules: hit on 16 or less, stand on 17+).
     *
     * @param {Object} dealerHand - Dealer's hand
     * @returns {boolean}
     */
    static shouldDealerHit(dealerHand) {
        if (!dealerHand) return false
        const value = this.getHandValue(dealerHand)
        return value < 17
    }
}

module.exports = HandEvaluator
