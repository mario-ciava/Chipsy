const { Hand } = require("pokersolver")
const { dealRandomCards, yieldEventLoop, clamp } = require("./utils")

const DEFAULT_STAGE = "pre-flop"

const resolveStageLabel = (boardCards = []) => {
    const length = Array.isArray(boardCards) ? boardCards.length : 0
    if (length >= 5) return "river"
    if (length === 4) return "turn"
    if (length === 3) return "flop"
    if (length > 0) return "deal"
    return DEFAULT_STAGE
}

const createResultBucket = (player) => ({
    id: player.id,
    win: 0,
    tie: 0,
    lose: 0,
    eligible: player.eligible,
    samples: 0
})

const buildStandardDeck = (config) => {
    const suits = Array.isArray(config?.cards?.suits) ? config.cards.suits : ["S", "C", "H", "D"]
    const ranks = Array.isArray(config?.cards?.ranks)
        ? config.cards.ranks
        : ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]
    const deck = []
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push(`${rank}${suit}`)
        }
    }
    return deck
}

const removeKnownCards = (deck, cards = []) => {
    if (!Array.isArray(deck) || !Array.isArray(cards)) return deck
    const working = deck.slice()
    for (const card of cards) {
        if (!card) continue
        const index = working.indexOf(card)
        if (index >= 0) {
            working.splice(index, 1)
        }
    }
    return working
}

const resolveDeck = (state, config) => {
    const remaining = state?.deck?.remaining
    if (Array.isArray(remaining) && remaining.length > 0) {
        return remaining.slice()
    }
    const fallback = buildStandardDeck(config)
    const known = []
    const appendCards = (collection) => {
        if (!Array.isArray(collection)) return
        for (const card of collection) {
            if (card) known.push(card)
        }
    }
    appendCards(state?.boardCards)
    appendCards(state?.deadCards)
    for (const player of state?.players || []) {
        appendCards(player?.cards)
    }
    return removeKnownCards(fallback, known)
}

const evaluateSnapshot = (players, boardCards) => {
    const entries = []
    for (const player of players) {
        if (!player.eligible) continue
        if (!Array.isArray(player.cards) || player.cards.length < 2) continue
        try {
            const solved = Hand.solve(boardCards.concat(player.cards))
            entries.push({ playerId: player.id, hand: solved })
        } catch (_error) {
            // Ignore invalid hands for this snapshot
        }
    }

    if (!entries.length) return null
    const bestHands = Hand.winners(entries.map((entry) => entry.hand))
    const winners = new Set(bestHands)
    return { entries, winners }
}

const createTexasCalculator = ({ config, logger }) => {
    const settings = config?.probabilities?.texas || {}
    const shared = config?.probabilities?.shared || {}
    const samplesConfig = settings.samples || {}
    const defaultIterations = Number.isFinite(samplesConfig.default) && samplesConfig.default > 0 ? samplesConfig.default : 1200
    const minIterations = Number.isFinite(samplesConfig.min) && samplesConfig.min > 0 ? samplesConfig.min : 150
    const maxIterations = Number.isFinite(samplesConfig.max) && samplesConfig.max > 0 ? samplesConfig.max : 6000
    const yieldEvery = Number.isFinite(shared.yieldEvery) && shared.yieldEvery > 0 ? shared.yieldEvery : 200

    const resolveIterations = (override) => {
        if (Number.isFinite(override) && override > 0) {
            return clamp(Math.floor(override), minIterations, maxIterations)
        }
        return clamp(defaultIterations, minIterations, maxIterations)
    }

    const buildPlayerState = (players = []) => {
        return players.map((player) => ({
            id: player?.id,
            cards: Array.isArray(player?.cards) ? player.cards.filter(Boolean) : [],
            folded: Boolean(player?.folded ?? player?.status?.folded),
            removed: Boolean(player?.removed ?? player?.status?.removed),
            allIn: Boolean(player?.allIn ?? player?.status?.allIn)
        })).map((player) => ({
            ...player,
            eligible: Boolean(player.id) && !player.folded && !player.removed && player.cards.length >= 2
        }))
    }

    const toResultPayload = (buckets, samples, metadata = {}) => {
        const players = {}
        for (const bucket of buckets.values()) {
            const denominator = bucket.eligible ? Math.max(samples, 1) : 1
            const win = bucket.eligible && denominator > 0 ? bucket.win / denominator : 0
            const tie = bucket.eligible && denominator > 0 ? bucket.tie / denominator : 0
            const lose = bucket.eligible && denominator > 0 ? bucket.lose / denominator : 1
            players[bucket.id] = {
                win: Number(win.toFixed(4)),
                tie: Number(tie.toFixed(4)),
                lose: Number(Math.max(0, 1 - (win + tie)).toFixed(4)),
                samples: bucket.eligible ? denominator : 0,
                eligible: bucket.eligible
            }
        }
        return {
            samples,
            players,
            metadata
        }
    }

    const calculate = async (state = {}, options = {}) => {
        const players = buildPlayerState(state.players || [])
        if (!players.length) {
            return null
        }

        const eligiblePlayers = players.filter((player) => player.eligible)
        if (!eligiblePlayers.length) {
            const payload = new Map(players.map((player) => [player.id, createResultBucket(player)]))
            return toResultPayload(payload, 1, {
                stage: resolveStageLabel(state.boardCards),
                reason: options?.reason || null,
                boardCards: Array.isArray(state.boardCards) ? state.boardCards.length : 0,
                note: "noEligiblePlayers"
            })
        }

        const bucketMap = new Map(players.map((player) => [player.id, createResultBucket(player)]))
        const boardCards = Array.isArray(state.boardCards) ? state.boardCards.filter(Boolean) : []
        const boardMissing = Math.max(0, 5 - boardCards.length)
        const metadata = {
            stage: resolveStageLabel(boardCards),
            reason: options?.reason || null,
            boardCards: boardCards.length,
            eligiblePlayers: eligiblePlayers.length
        }

        const deck = resolveDeck({ ...state, boardCards, players }, config)

        if (boardMissing === 0) {
            const evaluation = evaluateSnapshot(eligiblePlayers, boardCards)
            if (!evaluation) {
                return toResultPayload(bucketMap, 1, { ...metadata, note: "evaluationFailed" })
            }
            const uniqueWinners = evaluation.winners.size
            for (const entry of evaluation.entries) {
                const bucket = bucketMap.get(entry.playerId)
                if (!bucket) continue
                if (evaluation.winners.has(entry.hand)) {
                    if (uniqueWinners === 1) bucket.win += 1
                    else bucket.tie += 1
                } else {
                    bucket.lose += 1
                }
            }
            return toResultPayload(bucketMap, 1, metadata)
        }

        if (deck.length < boardMissing) {
            metadata.note = "insufficientDeck"
            if (logger?.warn) {
                logger.warn("Texas probability skipped: not enough cards to simulate", {
                    scope: "texasProbability",
                    boardMissing,
                    remaining: deck.length
                })
            }
            return toResultPayload(bucketMap, 1, metadata)
        }

        const iterations = resolveIterations(options?.iterations)
        let executedSamples = 0
        for (let i = 0; i < iterations; i++) {
            const workingDeck = deck.slice()
            const sampleBoard = boardCards.slice()
            const drawn = dealRandomCards(workingDeck, boardMissing)
            if (drawn.length !== boardMissing) {
                break
            }
            sampleBoard.push(...drawn)

            const evaluation = evaluateSnapshot(eligiblePlayers, sampleBoard)
            if (!evaluation) {
                continue
            }

            const winnerCount = evaluation.winners.size
            for (const entry of evaluation.entries) {
                const bucket = bucketMap.get(entry.playerId)
                if (!bucket) continue
                if (evaluation.winners.has(entry.hand)) {
                    if (winnerCount === 1) bucket.win += 1
                    else bucket.tie += 1
                } else {
                    bucket.lose += 1
                }
            }

            executedSamples++
            if (yieldEvery && executedSamples % yieldEvery === 0) {
                await yieldEventLoop()
            }
        }

        const totalSamples = executedSamples || 1
        return toResultPayload(bucketMap, totalSamples, metadata)
    }

    return {
        calculate
    }
}

module.exports = createTexasCalculator
