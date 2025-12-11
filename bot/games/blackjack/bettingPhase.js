const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require("discord.js")
const bankrollManager = require("../../utils/bankrollManager")
const setSeparator = require("../../../shared/utils/setSeparator")
const logger = require("../../../shared/logger")

/**
 * BettingPhase
 *
 * Manages the betting phase of blackjack, including bet collection,
 * validation, and timeout handling.
 */
class BettingPhase {
    constructor(game) {
        this.game = game
    }

    /**
     * Collects bets from all players at the table.
     * Players can place bets within min/max limits and have a timeout window.
     *
     * @param {Object} options - Betting phase configuration
     * @param {number} options.minBet - Minimum bet amount
     * @param {number} options.maxBet - Maximum bet amount
     * @param {number} options.timeoutMs - Betting window duration
     * @returns {Promise<Object>} { success: boolean, playersReady: number }
     */
    async collectBets(options = {}) {
        const { minBet, maxBet, timeoutMs } = options

        // Create betting message for players
        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle("🎰 Place your bets!")
            .setDescription(
                `Players, place your bets for the next hand.\n\n` +
                `**Min bet:** ${setSeparator(minBet)}$\n` +
                `**Max bet:** ${setSeparator(maxBet)}$\n\n` +
                `You have **${Math.round(timeoutMs / 1000)}s** to bet.`
            )

        const components = this.buildBettingComponents()

        // Send betting message via broadcaster
        await this.game.broadcaster.broadcast({
            embeds: [embed],
            components
        })

        // Wait for bets with timeout
        const result = await this.waitForBets(timeoutMs)

        return result
    }

    /**
     * Builds the button/modal components for betting.
     *
     * @returns {Array} Discord components array
     */
    buildBettingComponents() {
        const row = new ActionRowBuilder()

        // Quick bet buttons (25, 50, 100, custom)
        row.addComponents(
            new ButtonBuilder()
                .setCustomId("bj_bet_quick_25")
                .setLabel("25$")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("bj_bet_quick_50")
                .setLabel("50$")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("bj_bet_quick_100")
                .setLabel("100$")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("bj_bet_custom")
                .setLabel("Custom")
                .setStyle(ButtonStyle.Success)
        )

        return [row]
    }

    /**
     * Waits for players to place bets within the timeout window.
     *
     * @param {number} timeoutMs
     * @returns {Promise<Object>}
     */
    async waitForBets(timeoutMs) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.closeBettingPhase("timeout")
                resolve({
                    success: true,
                    playersReady: this.getPlayersWithBets().length,
                    timedOut: true
                })
            }, timeoutMs)

            // Store timeout reference for early resolution
            this.game._bettingTimeout = timeout
        })
    }

    /**
     * Validates a bet amount for a player.
     *
     * @param {Object} player
     * @param {number} betAmount
     * @param {number} minBet
     * @param {number} maxBet
     * @returns {Object} { valid: boolean, reason?: string }
     */
    validateBet(player, betAmount, minBet, maxBet) {
        const amount = Number(betAmount)

        if (!Number.isFinite(amount) || amount < 1) {
            return { valid: false, reason: "invalidAmount" }
        }

        if (amount < minBet) {
            return { valid: false, reason: "belowMinimum", minBet }
        }

        if (amount > maxBet) {
            return { valid: false, reason: "aboveMaximum", maxBet }
        }

        if (!bankrollManager.canAffordStack(player, amount)) {
            return { valid: false, reason: "insufficientFunds" }
        }

        return { valid: true }
    }

    /**
     * Processes a bet for a player.
     *
     * @param {Object} player
     * @param {number} betAmount
     * @returns {Object} { success: boolean, betAmount?: number }
     */
    processBet(player, betAmount) {
        const amount = Number(betAmount)

        if (!bankrollManager.withdrawStackOnly(player, amount)) {
            return { success: false, reason: "withdrawFailed" }
        }

        // Initialize bet structure
        if (!player.bets) {
            player.bets = {
                initial: 0,
                total: 0,
                insurance: 0
            }
        }

        player.bets.initial = amount
        player.bets.total = amount
        player.bets.insurance = 0

        // Mark player as ready
        if (!player.status) player.status = {}
        player.status.betPlaced = true

        logger.debug("Bet placed", {
            scope: "bettingPhase",
            playerId: player.id,
            amount
        })

        return {
            success: true,
            betAmount: amount
        }
    }

    /**
     * Closes the betting phase.
     *
     * @param {string} reason - "timeout", "allPlayersReady", or "manual"
     */
    closeBettingPhase(reason = "manual") {
        if (this.game._bettingTimeout) {
            clearTimeout(this.game._bettingTimeout)
            this.game._bettingTimeout = null
        }

        logger.debug("Betting phase closed", {
            scope: "bettingPhase",
            reason,
            playersWithBets: this.getPlayersWithBets().length
        })
    }

    /**
     * Gets players who have placed bets.
     *
     * @returns {Array} Players with bets
     */
    getPlayersWithBets() {
        return this.game.players.filter((player) => {
            return player.status?.betPlaced === true
        })
    }

    /**
     * Gets players who haven't placed bets yet.
     *
     * @returns {Array} Players without bets
     */
    getPlayersWithoutBets() {
        return this.game.players.filter((player) => {
            return player.status?.betPlaced !== true
        })
    }

    /**
     * Checks if all players have placed bets.
     *
     * @returns {boolean}
     */
    allPlayersReady() {
        return this.getPlayersWithoutBets().length === 0
    }

    /**
     * Removes players who didn't bet in time.
     *
     * @returns {Promise<Array>} Removed players
     */
    async removePlayersWithoutBets() {
        const playersWithoutBets = this.getPlayersWithoutBets()

        for (const player of playersWithoutBets) {
            await this.game.RemovePlayer(player, { reason: "noBet" })
        }

        return playersWithoutBets
    }
}

module.exports = BettingPhase
