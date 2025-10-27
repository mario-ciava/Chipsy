const config = require("../../config")
const logger = require("../logger")
const createTexasCalculator = require("./texasCalculator")
const createBlackjackCalculator = require("./blackjackCalculator")

const createProbabilityEngine = ({ config: runtimeConfig = config, logger: runtimeLogger = logger } = {}) => {
    const calculators = {
        texas: createTexasCalculator({ config: runtimeConfig, logger: runtimeLogger }),
        blackjack: createBlackjackCalculator({ config: runtimeConfig, logger: runtimeLogger })
    }

    const sharedConfig = runtimeConfig?.probabilities?.shared || {}
    const telemetryWindow = Number.isFinite(sharedConfig.telemetrySampleWindow) && sharedConfig.telemetrySampleWindow > 0
        ? sharedConfig.telemetrySampleWindow
        : 20

    const metrics = {
        texas: { runs: 0, totalSamples: 0, totalDurationMs: 0 },
        blackjack: { runs: 0, totalSamples: 0, totalDurationMs: 0 }
    }

    const history = []

    const recordRun = (type, { samples = 0, durationMs = 0, reason = null }) => {
        if (!metrics[type]) {
            metrics[type] = { runs: 0, totalSamples: 0, totalDurationMs: 0 }
        }
        metrics[type].runs += 1
        metrics[type].totalSamples += samples
        metrics[type].totalDurationMs += durationMs
        history.push({ type, samples, durationMs, reason, at: new Date().toISOString() })
        if (history.length > telemetryWindow) {
            history.shift()
        }
    }

    const runCalculator = async (type, state, options = {}) => {
        const calculator = calculators[type]
        if (!calculator || typeof calculator.calculate !== "function") {
            throw new Error(`Missing probability calculator for type ${type}`)
        }
        const startedAt = Date.now()
        const payload = await calculator.calculate(state, options)
        const durationMs = Date.now() - startedAt
        const samples = payload?.samples || 0
        const reason = options?.reason || null
        recordRun(type, { samples, durationMs, reason })
        if (runtimeLogger?.debug) {
            runtimeLogger.debug("Probability calculation completed", {
                scope: "probabilityEngine",
                type,
                durationMs,
                samples,
                reason
            })
        }
        return {
            type,
            updatedAt: new Date().toISOString(),
            durationMs,
            payload,
            reason
        }
    }

    return {
        calculate: (type, state, options) => runCalculator(type, state, options),
        calculateTexas: (state, options) => runCalculator("texas", state, options),
        calculateBlackjack: (state, options) => runCalculator("blackjack", state, options),
        getMetrics: () => ({
            metrics: { ...metrics },
            history: history.slice()
        })
    }
}

const probabilityEngine = createProbabilityEngine()

module.exports = {
    createProbabilityEngine,
    probabilityEngine
}
