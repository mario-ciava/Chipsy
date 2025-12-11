const bankrollManager = require("../../utils/bankrollManager")
const { recordNetWin } = bankrollManager
const setSeparator = require("../../../shared/utils/setSeparator")

/**
 * InsuranceManager
 *
 * Manages insurance bets in blackjack. Insurance is offered when dealer shows an Ace,
 * and pays 2:1 if dealer has blackjack.
 */
class InsuranceManager {
    constructor(game) {
        this.game = game
    }

    /**
     * Checks if insurance should be offered (dealer shows Ace).
     *
     * @returns {boolean}
     */
    shouldOfferInsurance() {
        const dealerUpcard = this.game.dealer?.cards?.[0]
        if (!dealerUpcard) return false
        const rank = dealerUpcard.split("")[0]
        return rank === "A"
    }

    /**
     * Checks if a player can afford and hasn't already taken insurance.
     *
     * @param {Object} player
     * @param {Object} hand - Current hand being played
     * @returns {boolean}
     */
    canPlayerTakeInsurance(player, hand) {
        if (!player || !hand) return false

        // Must have initial bet
        const initialBet = Number(player.bets?.initial) || 0
        if (initialBet < 1) return false

        // Insurance is half the initial bet
        const insuranceCost = Math.floor(initialBet / 2)
        if (insuranceCost < 1) return false

        // Player must not already have insurance
        if (player.bets.insurance > 0) return false

        // Player must be able to afford it
        if (!bankrollManager.canAffordStack(player, insuranceCost)) return false

        // Only offer before player has 3 cards
        if (hand.cards.length >= 3) return false

        return true
    }

    /**
     * Processes an insurance purchase for a player.
     *
     * @param {Object} player
     * @param {Function} formatPlayerName - Function to format player name for timeline
     * @returns {Object} { success: boolean, insuranceAmount: number }
     */
    processInsurancePurchase(player, formatPlayerName) {
        const initialBet = Number(player.bets?.initial) || 0
        const insuranceBet = Math.floor(initialBet / 2)

        if (insuranceBet < 1 || player.bets.insurance > 0) {
            return { success: false, insuranceAmount: 0 }
        }

        if (!bankrollManager.canAffordStack(player, insuranceBet)) {
            return { success: false, insufficientFunds: true, insuranceAmount: 0 }
        }

        if (!bankrollManager.withdrawStackOnly(player, insuranceBet)) {
            return { success: false, insufficientFunds: true, insuranceAmount: 0 }
        }

        player.bets.insurance += insuranceBet
        player.bets.total += insuranceBet

        player.status.insurance = {
            wager: insuranceBet,
            settled: false
        }

        const playerName = typeof formatPlayerName === "function"
            ? formatPlayerName(player)
            : player.tag || player.username || "Player"

        this.game.appendDealerTimeline(
            `${playerName} buys insurance (${setSeparator(insuranceBet)}$).`
        )

        return {
            success: true,
            insuranceAmount: insuranceBet
        }
    }

    /**
     * Resolves insurance bets after dealer reveals cards.
     * If dealer has blackjack, insurance pays 2:1.
     *
     * @param {boolean} dealerHasBlackjack
     * @param {Object} player
     * @param {Function} formatPlayerName - Function to format player name for timeline
     * @returns {Object} { paidOut: boolean, payoutAmount: number, netWin: number }
     */
    resolveInsurance(dealerHasBlackjack, player, formatPlayerName) {
        const insuranceWager = player.status?.insurance?.wager || 0

        // No insurance bet to resolve
        if (insuranceWager < 1 || player.status?.insurance?.settled) {
            return { paidOut: false, payoutAmount: 0, netWin: 0 }
        }

        if (!dealerHasBlackjack) {
            // Dealer doesn't have BJ - insurance bet is lost (already deducted)
            player.status.insurance.settled = true
            return { paidOut: false, payoutAmount: 0, netWin: -insuranceWager }
        }

        // Dealer has BJ - pay 2:1 (original bet + 2x wager)
        const insurancePayout = insuranceWager * 3 // Return bet + 2:1 winnings
        bankrollManager.depositStackOnly(player, insurancePayout)
        player.status.insurance.settled = true

        // Track in player stats
        player.status.won.grossValue += insurancePayout

        const insuranceNet = insurancePayout - insuranceWager
        player.status.won.netValue += insuranceNet

        if (insuranceNet > 0) {
            recordNetWin(player, insuranceNet)
        }

        const playerName = typeof formatPlayerName === "function"
            ? formatPlayerName(player)
            : player.tag || player.username || "Player"

        this.game.appendDealerTimeline(
            `${playerName} receives insurance payout (+${setSeparator(insurancePayout)}$).`
        )

        return {
            paidOut: true,
            payoutAmount: insurancePayout,
            netWin: insuranceNet
        }
    }

    /**
     * Gets the insurance cost for a given initial bet.
     *
     * @param {number} initialBet
     * @returns {number}
     */
    static getInsuranceCost(initialBet) {
        return Math.floor(Number(initialBet) / 2)
    }

    /**
     * Gets the insurance payout for a given insurance bet (assumes dealer has BJ).
     *
     * @param {number} insuranceBet
     * @returns {number} Total payout (bet + winnings)
     */
    static getInsurancePayout(insuranceBet) {
        return Number(insuranceBet) * 3
    }
}

module.exports = InsuranceManager
