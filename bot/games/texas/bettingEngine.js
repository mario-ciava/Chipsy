/**
 * bettingEngine.js
 *
 * Responsibility: all betting logic (actions, chip commits, side pots).
 * Used by: TexasGame
 *
 * Note: reads game state from the instance without changing its shape.
 * Only mutates player state in predictable ways.
 */

const { validateAmount, MAX_SAFE_STACK } = require("../shared/playerStateSchema")
const logger = require("../../utils/logger")
const { Hand } = require("pokersolver")

class BettingEngine {
    constructor(gameInstance) {
        this.game = gameInstance
    }

    /**
     * commitChips(player, desiredAmount): move chips from the stack to the active bet.
     *
     * Returns: amount actually committed.
     * Side effects: updates player.stack, player.bets, player.status.allIn.
     */
    commitChips(player, desiredAmount) {
        if (!player || desiredAmount <= 0) return 0

        const amount = Math.min(player.stack, Math.floor(desiredAmount))
        if (amount <= 0) return 0

        player.stack -= amount
        player.bets.current += amount
        player.bets.total += amount

        if (player.status) {
            player.status.totalContribution = (player.status.totalContribution || 0) + amount
        }

        this.game.bets.total += amount

        if (player.stack === 0) {
            player.status.allIn = true
            player.status.lastAllInAmount = Math.max(player.bets.total, 0)
        }

        return amount
    }

    /**
     * movePlayerToTotal(player, targetTotal): move the player to a target total bet.
     *
     * Returns: amount committed to reach the target.
     */
    movePlayerToTotal(player, targetTotal) {
        if (!player) return 0

        const maxTotal = player.bets.current + player.stack
        const sanitizedTotal = Math.min(maxTotal, Math.max(player.bets.current, Math.floor(targetTotal)))
        const required = sanitizedTotal - player.bets.current

        if (required <= 0) return 0
        return this.commitChips(player, required)
    }

    /**
     * executeAction(type, player, params, options): execute a betting action.
     *
     * Supported actions: fold, check, call, bet, raise, allin.
     *
     * Returns: { success, type, delta, total } | { success: false, reason }
     */
    executeAction(type, player, params = null, options = {}) {
        const { isBlind = false } = options

        if (!player || player.status?.removed) {
            return { success: false, reason: "invalidPlayer" }
        }

        const previousCurrentMax = this.game.bets.currentMax
        const previousBetTotal = player.bets?.current || 0

        try {
            switch (type) {
                case "fold":
                    player.status.folded = true
                    player.status.movedone = true
                    break

                case "check":
                    player.status.movedone = true
                    break

                case "call": {
                    const callAmount = Math.max(0, this.game.bets.currentMax - player.bets.current)
                    if (callAmount > 0) {
                        this.commitChips(player, callAmount)
                    }
                    player.status.movedone = true
                    break
                }

                case "bet": {
                    const requestedTotal = isBlind
                        ? player.bets.current + validateAmount(params, MAX_SAFE_STACK)
                        : Math.max(this.game.getTableMinBet(), validateAmount(params, MAX_SAFE_STACK) || this.game.getTableMinBet())
                    const cappedTotal = this.game.capTotalToOpponentMax
                        ? this.game.capTotalToOpponentMax(player, requestedTotal)
                        : requestedTotal
                    this.movePlayerToTotal(player, cappedTotal)
                    player.status.movedone = isBlind ? false : true
                    break
                }

                case "raise": {
                    const minimumTotal = this.game.bets.currentMax + this.game.bets.minRaise
                    const parsed = validateAmount(params, MAX_SAFE_STACK)
                    const requestedTotal = parsed > 0 ? Math.max(parsed, minimumTotal) : minimumTotal
                    const cappedTotal = this.game.capTotalToOpponentMax
                        ? this.game.capTotalToOpponentMax(player, requestedTotal)
                        : requestedTotal
                    this.movePlayerToTotal(player, cappedTotal)
                    player.status.movedone = true
                    break
                }

                case "allin": {
                    if (player.stack > 0) {
                        this.commitChips(player, player.stack)
                    }
                    player.status.movedone = true
                    break
                }

                default:
                    return { success: false, reason: "unknownAction" }
            }

            // Update tracking
            const delta = Math.max(0, player.bets.current - previousBetTotal)
            player.status.lastAction = {
                type,
                amount: delta > 0 ? delta : null,
                total: player.bets.current,
                ts: Date.now(),
                isBlind: Boolean(isBlind)
            }

            // Update bet max and min raise
            if (player.bets.current > previousCurrentMax) {
                const newDelta = player.bets.current - previousCurrentMax
                this.game.bets.currentMax = player.bets.current
                if (newDelta > 0) {
                    const previousMinRaise = this.game.bets.minRaise
                    this.game.bets.minRaise = Math.max(previousMinRaise, newDelta, this.game.getTableMinBet())
                }
                if (!isBlind) {
                    this.resetPlayersAfterAggression(player)
                }
            }

            return {
                success: true,
                type,
                delta,
                total: player.bets.current
            }
        } catch (error) {
            logger.error("BettingEngine action failed", {
                scope: "bettingEngine",
                type,
                playerId: player?.id,
                error: error?.message
            })
            return { success: false, reason: "executionError", error }
        }
    }

    /**
     * resetPlayersAfterAggression(actor): clear movedone for players after an aggressive action.
     */
    resetPlayersAfterAggression(actor) {
        for (const participant of this.game.players) {
            if (!participant || participant.id === actor.id) continue
            if (participant.status.folded || participant.status.removed || participant.status.allIn) continue
            participant.status.movedone = false
        }
    }

    /**
     * resetBettingRound(): reset bets for a new round.
     */
    resetBettingRound() {
        for (const player of this.game.players) {
            if (player?.bets) {
                player.bets.current = 0
            }
            if (player?.status) {
                player.status.lastAction = null
            }
        }
        this.game.bets.currentMax = 0
        this.game.bets.minRaise = this.game.getTableMinBet()
    }

    /**
     * buildSidePots(): calculate side pots from the current betting state.
     *
     * Handles all-in players with different bet amounts.
     * Returns: [{ amount, eligiblePlayers }]
     */
    buildSidePots() {
        const entries = this.game.players
            .map((player) => ({
                player,
                remaining: Math.max(0, player.bets?.total || 0),
                eligible: !player.status?.folded && !player.status?.removed
            }))
            .filter((entry) => entry.remaining > 0)
            .sort((a, b) => a.remaining - b.remaining)

        const pots = []
        const working = [...entries]

        while (working.length > 0) {
            const smallest = working[0].remaining
            if (smallest <= 0) {
                working.shift()
                continue
            }

            const contributors = working.filter((entry) => entry.remaining > 0)
            if (!contributors.length) break

            const potAmount = smallest * contributors.length
            const eligiblePlayers = contributors.filter((entry) => entry.eligible).map((entry) => entry.player)
            pots.push({ amount: potAmount, eligiblePlayers })

            for (const entry of contributors) {
                entry.remaining -= smallest
            }

            while (working.length && working[0].remaining <= 0) {
                working.shift()
            }
        }

        return pots
    }

    /**
     * distributePots(pots, contenders): distribute pots to winners.
     *
     * Arguments:
     * - pots: array of { amount, eligiblePlayers }
     * - contenders: players still contesting with hands
     *
     * Returns: [{ amount, winners: [{ player, amount }] }]
     */
    distributePots(pots, contenders = []) {
        const resolved = []

        for (const pot of pots) {
            const eligiblePlayers = pot.eligiblePlayers.filter(Boolean)
            if (!eligiblePlayers.length) continue

            let winners = eligiblePlayers.filter((player) => {
                return contenders.includes(player) && player.hand
            })

            if (winners.length) {
                const bestHands = Hand.winners(winners.map((player) => player.hand))
                winners = winners.filter((player) => bestHands.includes(player.hand))
            } else {
                winners = eligiblePlayers
            }

            if (!winners.length) continue

            const baseShare = Math.floor(pot.amount / winners.length)
            let remainder = pot.amount - baseShare * winners.length

            const winnerEntries = winners.map((player) => {
                const payout = baseShare + (remainder-- > 0 ? 1 : 0)
                if (!player.status.won) {
                    player.status.won = { grossValue: 0, netValue: 0, expEarned: 0, goldEarned: 0 }
                }
                player.status.won.grossValue += payout
                return { player, amount: payout }
            })

            resolved.push({ amount: pot.amount, winners: winnerEntries })
        }

        return resolved
    }
}

module.exports = BettingEngine
