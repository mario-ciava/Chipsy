const createPlayer = (id, overrides = {}) => {
    const stack = Number.isFinite(overrides.stack) ? overrides.stack : 1000
    const currentBet = Number.isFinite(overrides.currentBet) ? overrides.currentBet : 0
    const totalBet = Number.isFinite(overrides.totalBet) ? overrides.totalBet : currentBet
    return {
        id,
        tag: overrides.tag || id,
        username: overrides.username || id,
        bot: Boolean(overrides.bot),
        stack,
        bets: {
            current: currentBet,
            total: totalBet
        },
        status: {
            folded: false,
            removed: false,
            allIn: false,
            movedone: false,
            ...(overrides.status || {})
        },
        cards: Array.isArray(overrides.cards) ? [...overrides.cards] : []
    }
}

const createBroadcasterStub = () => {
    const payloads = []
    const broadcaster = {
        broadcast: jest.fn(async (payload, options) => {
            payloads.push({ payload, options })
            return payload
        }),
        notify: jest.fn(async (payload) => {
            payloads.push({ payload, options: { notify: true } })
            return payload
        }),
        createCollectors: jest.fn(),
        prepareForNewRound: jest.fn(),
        getCurrentMessages: jest.fn(() => []),
        targets: new Map()
    }
    return { broadcaster, payloads }
}

const createTexasStubGame = (overrides = {}) => {
    const players = overrides.players || []
    const inGamePlayers = overrides.inGamePlayers || players
    const { broadcaster, payloads } = createBroadcasterStub()

    const game = {
        playing: true,
        hands: overrides.hands || 1,
        bets: {
            minRaise: overrides.minRaise || 50,
            currentMax: overrides.currentMax || 0,
            total: overrides.total || 0,
            pots: overrides.pots || [],
            displayTotal: overrides.displayTotal || 0
        },
        players,
        inGamePlayers,

        // Core collaborators
        betting: {
            resetBettingRound: jest.fn(),
            buildSidePots: jest.fn(() => []),
            distributePots: jest.fn(() => [])
        },
        broadcaster,
        messages: {
            cleanupHoleCardsMessages: jest.fn()
        },

        // Game methods used by components
        getTableMinBet: jest.fn(() => 100),
        capTotalToOpponentMax: jest.fn((player, total) => total),
        resetPlayersAfterAggression: jest.fn(),
        hasActiveOpponents: jest.fn(() => true),
        hasOpponentWithChips: jest.fn(() => true),

        UpdateInGame: jest.fn(),
        updateActionOrder: jest.fn(),
        getBettingStartIndex: jest.fn(() => 0),
        queueProbabilityUpdate: jest.fn(),
        findNextPendingPlayer: jest.fn(() => null),
        NextPlayer: jest.fn(),
        resolveNextPhase: jest.fn(() => "showdown"),

        burnCard: jest.fn(),
        PickRandom: jest.fn(async (arr, n) => {
            if (!Array.isArray(arr)) return []
            return arr.splice(0, n)
        }),

        updateDisplayPotForRender: jest.fn(),
        settleCurrentBetsForRender: jest.fn(),
        broadcastPhaseSnapshot: jest.fn(),

        clearProbabilitySnapshot: jest.fn(),
        applyGoldRewards: jest.fn(),
        SendMessage: jest.fn(),
        evaluateHandInactivity: jest.fn(async () => false),
        StartGame: jest.fn(),
        Stop: jest.fn(),
        scheduleHandCleanup: jest.fn()
    }

    return { game, broadcaster, payloads }
}

module.exports = {
    createPlayer,
    createBroadcasterStub,
    createTexasStubGame
}
