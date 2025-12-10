const FALLBACK_REBUY_DEFAULT_MS = 60 * 1000
const FALLBACK_REBUY_MIN_MS = 30 * 1000
const FALLBACK_REBUY_MAX_MS = 10 * 60 * 1000

const clampNumber = (value, min, max, fallback) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return fallback
    return Math.max(min, Math.min(max, Math.floor(numeric)))
}

const normalizeBoolean = (value, fallback = false) => {
    if (value === undefined || value === null) return fallback
    if (typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return fallback
        return value !== 0
    }
    const normalized = String(value).trim().toLowerCase()
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false
    return fallback
}

const normalizeRebuyMode = (value, fallback = "on") => {
    if (value === undefined || value === null) return fallback
    const normalized = typeof value === "string"
        ? value.trim().toLowerCase()
        : value
    if (normalized === "off" || normalized === false) return "off"
    if (normalized === "once") return "once"
    if (normalized === "on" || normalized === true) return "on"
    return fallback
}

const resolveRebuyDefaults = (rebuyConfig = {}, options = {}) => {
    const min = Number.isFinite(rebuyConfig.offerTimeout?.allowedRange?.min)
        ? rebuyConfig.offerTimeout.allowedRange.min
        : FALLBACK_REBUY_MIN_MS
    const max = Number.isFinite(rebuyConfig.offerTimeout?.allowedRange?.max)
        ? rebuyConfig.offerTimeout.allowedRange.max
        : FALLBACK_REBUY_MAX_MS

    const preferredDefault = Number.isFinite(options.preferredDefaultMs)
        ? options.preferredDefaultMs
        : null
    const configDefault = Number.isFinite(rebuyConfig.offerTimeout?.default)
        ? rebuyConfig.offerTimeout.default
        : null

    const rawDefault = preferredDefault ?? configDefault ?? FALLBACK_REBUY_DEFAULT_MS
    const rebuyWindowMs = clampNumber(rawDefault, min, max, rawDefault)
    const allowRebuy = rebuyConfig.enabled?.default !== false

    return {
        allowRebuy,
        rebuyWindowMs,
        minWindowMs: min,
        maxWindowMs: max
    }
}

module.exports = {
    clampNumber,
    normalizeBoolean,
    normalizeRebuyMode,
    resolveRebuyDefaults
}
