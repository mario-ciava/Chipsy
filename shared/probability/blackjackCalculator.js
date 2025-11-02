const { pickRandomCard, yieldEventLoop, clamp } = require("./utils")

const TEN_RANKS = new Set(["T", "J", "Q", "K"])

const evaluateHand = (cards = []) => {
    const working = Array.isArray(cards) ? cards.filter(Boolean) : []
    if (!working.length) {
        return { value: 0, soft: false, busted: false, blackjack: false }
    }
    let value = 0
    let aces = 0
    for (const card of working) {
        const rank = String(card).charAt(0)
        if (rank === "A") {
            aces++
            value += 11
        } else if (TEN_RANKS.has(rank)) {
            value += 10
        } else {
            const numeric = parseInt(rank, 10)
            value += Number.isFinite(numeric) ? numeric : 0
        }
    }
    let softAces = aces
    while (value > 21 && softAces > 0) {
        value -= 10
        softAces--
    }
    const blackjack = working.length === 2 && aces > 0 && value === 21 && working.some((card) => TEN_RANKS.has(String(card).charAt(0)))
    return {
        value,
        soft: softAces > 0,
        busted: value > 21,
        blackjack
    }
}

const shouldPlayerHit = (handState, evaluation, rules) => {
    if (!handState || !evaluation) return false
    if (handState.locked || handState.doubleDown) return false
    if (handState.fromSplitAce && Array.isArray(handState.cards) && handState.cards.length >= 2) return false
    if (evaluation.busted) return false
    const standOn = Number.isFinite(rules.standOnValue) ? rules.standOnValue : 17
    if (evaluation.value < standOn) return true
    if (evaluation.value > standOn) return false
    return Boolean(rules.hitSoft17 && evaluation.soft)
}

const shouldDealerHit = (evaluation, rules) => {
    if (!evaluation) return false
    if (evaluation.busted) return false
    const standOn = Number.isFinite(rules.standOnValue) ? rules.standOnValue : 17
    if (evaluation.value < standOn) return true
    if (evaluation.value > standOn) return false
    return Boolean(rules.hitSoft17 && evaluation.soft)
}

const resolveWeight = (bet) => {
    if (!Number.isFinite(bet) || bet <= 0) return 1
    return clamp(Math.floor(bet), 1, 1_000_000)
}

const normalizeHandState = (hand, index = 0) => ({
    index,
    cards: Array.isArray(hand?.cards) ? hand.cards.filter(Boolean) : [],
    bet: Number(hand?.bet) || 0,
    locked: Boolean(hand?.locked),
    busted: Boolean(hand?.busted),
    blackjack: Boolean(hand?.BJ),
    result: typeof hand?.result === "string" ? hand.result : null,
    fromSplitAce: Boolean(hand?.fromSplitAce),
    doubleDown: Boolean(hand?.doubleDown)
})

const playHand = (handState, deck, rules) => {
    const cards = handState.cards.slice()
    let evaluation = evaluateHand(cards)
    if (handState.result) {
        return {
            cards,
            evaluation,
            forcedResult: handState.result
        }
    }
    if (handState.busted) {
        return {
            cards,
            evaluation,
            forcedResult: "lose"
        }
    }
    while (shouldPlayerHit({ ...handState, cards }, evaluation, rules)) {
        const card = pickRandomCard(deck)
        if (!card) break
        cards.push(card)
        evaluation = evaluateHand(cards)
        if (evaluation.busted) break
    }
    return {
        cards,
        evaluation,
        forcedResult: evaluation.busted ? "lose" : null
    }
}

const playDealer = (dealerState, deck, rules) => {
    const cards = Array.isArray(dealerState?.cards) ? dealerState.cards.filter(Boolean) : []
    if (!cards.length) return null
    let evaluation = evaluateHand(cards)
    if (dealerState?.forcedResult) {
        return {
            cards,
            evaluation,
            forcedResult: dealerState.forcedResult
        }
    }
    while (shouldDealerHit(evaluation, rules)) {
        const card = pickRandomCard(deck)
        if (!card) break
        cards.push(card)
        evaluation = evaluateHand(cards)
        if (evaluation.busted) break
    }
    return {
        cards,
        evaluation,
        forcedResult: evaluation.busted ? "busted" : null
    }
}

const resolveOutcome = (handResult, dealerResult) => {
    if (!handResult) return null
    if (handResult.forcedResult) {
        return handResult.forcedResult
    }
    const playerEval = handResult.evaluation
    if (!playerEval) return null
    if (playerEval.busted) return "lose"
    if (!dealerResult) return null
    const dealerEval = dealerResult.evaluation
    if (!dealerEval) return null
    if (dealerEval.busted) return "win"
    if (playerEval.blackjack && !dealerEval.blackjack) return "win"
    if (!playerEval.blackjack && dealerEval.blackjack) return "lose"
    if (playerEval.value > dealerEval.value) return "win"
    if (playerEval.value < dealerEval.value) return "lose"
    return "push"
}

const buildPlayerStats = (players) => {
    const statsMap = new Map()
    for (const player of players) {
        if (!player.id) continue
        if (!Array.isArray(player.hands) || player.hands.length === 0) continue
        const weights = player.hands.map((hand) => resolveWeight(hand.bet))
        const totalWeight = weights.reduce((sum, value) => sum + value, 0) || player.hands.length || 1
        statsMap.set(player.id, {
            id: player.id,
            weights,
            totalWeight,
            hands: player.hands.map(() => ({ win: 0, push: 0, lose: 0 })),
            win: 0,
            push: 0,
            lose: 0
        })
    }
    return statsMap
}

const createBlackjackCalculator = ({ config, logger }) => {
    const settings = config?.probabilities?.blackjack || {}
    const shared = config?.probabilities?.shared || {}
    const samplesConfig = settings.samples || {}
    const defaultIterations = Number.isFinite(samplesConfig.default) && samplesConfig.default > 0 ? samplesConfig.default : 900
    const minIterations = Number.isFinite(samplesConfig.min) && samplesConfig.min > 0 ? samplesConfig.min : 150
    const maxIterations = Number.isFinite(samplesConfig.max) && samplesConfig.max > 0 ? samplesConfig.max : 5000
    const chunkSize = Number.isFinite(settings.chunkSize) && settings.chunkSize > 0 ? settings.chunkSize : 120
    const playerRules = {
        standOnValue: settings.playerStrategy?.standOnValue ?? 17,
        hitSoft17: settings.playerStrategy?.hitSoft17 !== false
    }
    const dealerRules = {
        standOnValue: 17,
        hitSoft17: Boolean(settings.dealer?.hitSoft17)
    }

    const resolveIterations = (override) => {
        if (Number.isFinite(override) && override > 0) {
            return clamp(Math.floor(override), minIterations, maxIterations)
        }
        return clamp(defaultIterations, minIterations, maxIterations)
    }

    const normalizeDealerState = (dealer = {}) => ({
        cards: Array.isArray(dealer.cards) ? dealer.cards.filter(Boolean) : [],
        forcedResult: typeof dealer.result === "string" ? dealer.result : null
    })

    const calculate = async (state = {}, options = {}) => {
        const players = Array.isArray(state.players)
            ? state.players.map((player) => ({
                id: player?.id,
                hands: Array.isArray(player?.hands)
                    ? player.hands.map((hand, index) => normalizeHandState(hand, index))
                    : []
            }))
            : []

        if (!players.length) return null
        const statsMap = buildPlayerStats(players)
        if (!statsMap.size) return null

        const remainingDeck = Array.isArray(state.deck?.remaining)
            ? state.deck.remaining.filter(Boolean)
            : []
        if (!remainingDeck.length) {
            if (logger?.debug) {
                logger.debug("Blackjack probability skipped: empty deck snapshot", {
                    scope: "blackjackProbability"
                })
            }
            return null
        }

        const dealerState = normalizeDealerState(state.dealer)
        if (!dealerState.cards.length) return null

        const iterations = resolveIterations(options?.iterations)
        for (let i = 0; i < iterations; i++) {
            const iterationDeck = remainingDeck.slice()
            const pendingOutcomes = []

            for (const player of players) {
                const stats = statsMap.get(player.id)
                if (!stats) continue
                player.hands.forEach((handState, index) => {
                    const result = playHand(handState, iterationDeck, playerRules)
                    pendingOutcomes.push({ stats, handIndex: index, result })
                })
            }

            const dealerResult = playDealer(dealerState, iterationDeck, dealerRules)

            for (const pending of pendingOutcomes) {
                const { stats, handIndex, result } = pending
                if (!stats || !result) continue
                const outcome = resolveOutcome(result, dealerResult)
                if (!outcome) continue
                const handStats = stats.hands[handIndex]
                if (handStats) {
                    handStats[outcome] = (handStats[outcome] || 0) + 1
                }
                const weight = stats.weights[handIndex] || 1
                stats[outcome] += weight
            }

            if (chunkSize && i > 0 && i % chunkSize === 0) {
                await yieldEventLoop()
            }
        }

        const payload = {
            samples: iterations,
            players: {},
            metadata: {
                reason: options?.reason || null,
                stage: state.stage || null,
                awaitingPlayerId: state.awaitingPlayerId || null
            }
        }

        for (const [playerId, stats] of statsMap.entries()) {
            const denominator = Math.max(stats.totalWeight * iterations, 1)
            const win = stats.win / denominator
            const push = stats.push / denominator
            const lose = Math.max(0, 1 - (win + push))
            payload.players[playerId] = {
                win: Number(win.toFixed(4)),
                push: Number(push.toFixed(4)),
                lose: Number(lose.toFixed(4)),
                samples: iterations,
                hands: stats.hands.map((handStats) => ({
                    win: Number((handStats.win / iterations).toFixed(4)),
                    push: Number((handStats.push / iterations).toFixed(4)),
                    lose: Number((handStats.lose / iterations).toFixed(4))
                }))
            }
        }

        return payload
    }

    return {
        calculate
    }
}

module.exports = createBlackjackCalculator
