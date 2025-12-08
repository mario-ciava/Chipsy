/**
 * handProgression.js
 *
 * Responsibility: hand progression logic (NextHand, NextPhase, handleShowdown, handleFoldWin).
 * Used by: TexasGame
 *
 * Note: coordinates game state, betting, and hand outcome.
 */

const logger = require("../../utils/logger")
const { Hand } = require("pokersolver")

class HandProgression {
    constructor(gameInstance) {
        this.game = gameInstance
    }

    /**
     * resolveNextPhase(): determine the next phase based on the community cards.
     *
     * Flow: pre-flop -> flop -> turn -> river -> showdown.
     */
    resolveNextPhase() {
        if (this.game.tableCards.length === 0) return "flop"
        if (this.game.tableCards.length === 3) return "turn"
        if (this.game.tableCards.length === 4) return "river"
        return "showdown"
    }

    /**
     * NextPhase(phase): advance to a specific phase.
     *
     * For showdown, evaluate hands.
     * Otherwise, deal community cards, reset the betting round, and move to the next player.
     */
    async NextPhase(phase) {
        const phases = ["flop", "turn", "river", "showdown"]
        if (!phases.includes(phase)) return

        if (phase === "showdown") {
            await this.handleShowdown()
            return
        }

        // Burn a card and deal community cards
        if (phase === "flop") {
            await this.game.burnCard()
            this.game.tableCards = await this.game.PickRandom(this.game.cards, 3)
        } else {
            await this.game.burnCard()
            const [card] = await this.game.PickRandom(this.game.cards, 1)
            if (card) this.game.tableCards.push(card)
        }

        // Reset betting round
        this.game.betting.resetBettingRound()
        this.game.inGamePlayers.forEach((player) => {
            if (!player.status.folded && !player.status.allIn) {
                player.status.movedone = false
            }
        })

        this.game.UpdateInGame()
        this.game.updateActionOrder(this.game.getBettingStartIndex())
        this.game.queueProbabilityUpdate(`phase:${phase}`)

        // Find the next player who still needs to act
        const nextPlayer = this.game.findNextPendingPlayer()
        if (nextPlayer) {
            await this.game.NextPlayer(nextPlayer)
        } else {
            // If no one needs to act, advance to the next phase
            await this.NextPhase(this.resolveNextPhase())
        }
    }

    /**
     * handleFoldWin(winner): handle the case where everyone except one player has folded.
     *
     * The winner takes the entire pot.
     */
    async handleFoldWin(winner) {
        if (!winner) return

        if (!winner.status.won) {
            winner.status.won = { grossValue: 0, netValue: 0, expEarned: 0, goldEarned: 0 }
        }

        winner.status.won.grossValue += this.game.bets.total
        this.game.bets.pots = [{
            amount: this.game.bets.total,
            winners: [{ player: winner, amount: this.game.bets.total }]
        }]
        this.game.bets.total = 0

        this.game.clearProbabilitySnapshot()
        this.game.applyGoldRewards(this.game.players)

        await this.game.SendMessage("handEnded", { showdown: false, revealWinnerId: winner.id })

        const stopped = await this.game.evaluateHandInactivity()
        if (!stopped) {
            await this.NextHand()
        }
    }

    /**
     * handleShowdown(): evaluate all contenders' hands and distribute pots.
     *
     * Flow:
     * 1. Evaluate each hand using Hand.solve.
     * 2. Build side pots.
     * 3. Distribute pots to winners.
     * 4. Apply gold rewards.
     * 5. Send the end-of-hand message.
     */
    async handleShowdown() {
        const contenders = this.game.players.filter(
            (player) => !player.status.folded && !player.status.removed
        )

        // Edge case: no contenders left
        if (!contenders.length) {
            const fallback = this.game.players.find((p) => !p.status.removed)
            if (fallback) {
                await this.handleFoldWin(fallback)
            } else {
                await this.game.Stop({ reason: "notEnoughPlayers" })
            }
            return
        }

        // Evaluate hands
        contenders.forEach((player) => {
            try {
                player.hand = Hand.solve(this.game.tableCards.concat(player.cards))
            } catch (error) {
                logger.error("Failed to evaluate Texas hand", {
                    scope: "handProgression",
                    playerId: player.id,
                    error: error?.message
                })
                player.hand = null
            }
        })

        // Build and distribute side pots
        const pots = this.game.betting.buildSidePots()
        const resolved = pots.length ? this.game.betting.distributePots(pots, contenders) : []

        // Fallback: if no winner is found (edge case), give everything to the first contender
        if (!resolved.length) {
            const defaultWinner = contenders[0]
            if (defaultWinner) {
                if (!defaultWinner.status.won) {
                    defaultWinner.status.won = { grossValue: 0, netValue: 0, expEarned: 0, goldEarned: 0 }
                }
                defaultWinner.status.won.grossValue += this.game.bets.total
                this.game.bets.pots = [{
                    amount: this.game.bets.total,
                    winners: [{ player: defaultWinner, amount: this.game.bets.total }]
                }]
            } else {
                this.game.bets.pots = []
            }
        } else {
            this.game.bets.pots = resolved
        }

        this.game.bets.total = 0
        this.game.clearProbabilitySnapshot()
        this.game.applyGoldRewards(this.game.players)

        await this.game.SendMessage("handEnded")

        const stopped = await this.game.evaluateHandInactivity()
        if (!stopped) {
            await this.NextHand()
        }
    }

    /**
     * NextHand(): prepare the next hand.
     *
     * Flow:
     * 1. Award winners.
     * 2. Remove or park busted players (stack < minBet).
     * 3. Verify there are enough players.
     * 4. Start a new hand.
     */
    async NextHand() {
        if (!this.game.playing) return

        // Assign rewards
        await Promise.all(this.game.players.map((player) => this.game.AssignRewards(player)))

        // Remove or park busted players (exclude already removed/pendingRemoval/pendingRebuy)
        const tableMinBet = this.game.getTableMinBet()
        const bustedPlayers = this.game.players.filter((p) =>
            p.stack < tableMinBet &&
            !p.status?.removed &&
            !p.status?.pendingRemoval &&
            !p.status?.pendingRebuy
        )
        for (const busted of bustedPlayers) {
            await this.game.handleBustedPlayer(busted)
        }

        // Check minimum players (count only active, exclude pendingRebuy)
        const activePlayers = this.game.players.filter(p => !p.status?.removed && !p.status?.pendingRemoval && !p.status?.pendingRebuy)
        const pendingRebuys = this.game.players.filter(p => p.status?.pendingRebuy)
        if (activePlayers.length < this.game.getMinimumPlayers()) {
            if (pendingRebuys.length > 0) {
                await this.game.waitForPendingRebuys()
                return
            }
            return this.game.Stop({ reason: "notEnoughPlayers" })
        }

        // Start new hand
        await this.game.StartGame()
    }
}

module.exports = HandProgression
