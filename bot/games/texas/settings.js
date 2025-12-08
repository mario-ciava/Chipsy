const config = require("../../../config")

const clampNumber = (value, min, max, fallback) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return fallback
    return Math.max(min, Math.min(max, Math.floor(numeric)))
}

const resolveRebuyDefaults = () => {
    const rebuyConfig = config?.texas?.rebuy || {}
    const min = Number.isFinite(rebuyConfig.offerTimeout?.allowedRange?.min)
        ? rebuyConfig.offerTimeout.allowedRange.min
        : 30 * 1000
    const max = Number.isFinite(rebuyConfig.offerTimeout?.allowedRange?.max)
        ? rebuyConfig.offerTimeout.allowedRange.max
        : 10 * 60 * 1000

    // Force a 60s default (clamped to allowed range), independent of config default
    const defaultWindow = clampNumber(60 * 1000, min, max, 60 * 1000)

    const allowRebuyDefault = rebuyConfig.enabled?.default !== false

    return {
        allowRebuy: allowRebuyDefault,
        rebuyWindowMs: defaultWindow,
        minWindowMs: min,
        maxWindowMs: max
    }
}

const defaults = resolveRebuyDefaults()

const normalizeRebuyMode = (value) => {
    if (value === "off" || value === false) return "off"
    if (value === "once") return "once"
    return "on"
}

const resolveTexasSettings = ({ overrides = {} } = {}) => {
    const merged = {
        allowRebuyMode: normalizeRebuyMode(
            overrides.allowRebuyMode !== undefined
                ? overrides.allowRebuyMode
                : overrides.allowRebuy // backward compatible boolean
        ),
        rebuyWindowMs: clampNumber(
            overrides.rebuyWindowMs ?? defaults.rebuyWindowMs,
            defaults.minWindowMs,
            defaults.maxWindowMs,
            defaults.rebuyWindowMs
        ),
        autoCleanHands: Boolean(overrides.autoCleanHands)
    }
    return merged
}

module.exports = {
    resolveTexasSettings,
    defaults
}
