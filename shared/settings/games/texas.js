const config = require("../../../config")
const { clampNumber, normalizeBoolean, normalizeRebuyMode, resolveRebuyDefaults } = require("../common")

const SUPPORTED_KEYS = ["enabled", "allowRebuyMode", "rebuyWindowMs", "actionTimeoutMs", "autoCleanHands"]

const resolveActionTimeoutDefaults = () => {
    const range = config?.texas?.actionTimeout?.allowedRange || {}
    const fallbackMin = 15 * 1000
    const fallbackMax = 120 * 1000
    const min = Number.isFinite(range.min) ? range.min : fallbackMin
    const max = Number.isFinite(range.max) ? range.max : fallbackMax
    const rawDefault = Number.isFinite(config?.texas?.actionTimeout?.default)
        ? config.texas.actionTimeout.default
        : 45 * 1000
    const actionTimeoutMs = clampNumber(rawDefault, min, max, rawDefault)
    return { actionTimeoutMs, minActionTimeoutMs: min, maxActionTimeoutMs: max }
}

const resolveTexasDefaults = () => {
    const rebuyDefaults = resolveRebuyDefaults(config?.texas?.rebuy)
    const actionTimeoutDefaults = resolveActionTimeoutDefaults()
    return Object.freeze({
        enabled: true,
        allowRebuyMode: rebuyDefaults.allowRebuy ? "on" : "off",
        rebuyWindowMs: rebuyDefaults.rebuyWindowMs,
        minWindowMs: rebuyDefaults.minWindowMs,
        maxWindowMs: rebuyDefaults.maxWindowMs,
        actionTimeoutMs: actionTimeoutDefaults.actionTimeoutMs,
        minActionTimeoutMs: actionTimeoutDefaults.minActionTimeoutMs,
        maxActionTimeoutMs: actionTimeoutDefaults.maxActionTimeoutMs,
        autoCleanHands: false
    })
}

const defaults = resolveTexasDefaults()

const normalizeDurationSetting = (value, min, max) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) {
        return { ok: false, reason: "invalid-number" }
    }
    const clamped = clampNumber(numeric, min, max, numeric)
    return { ok: true, value: clamped }
}

const normalizeTexasSetting = (key, value) => {
    switch (key) {
        case "enabled":
            return { ok: true, value: normalizeBoolean(value, defaults.enabled) }
        case "allowRebuyMode":
            return { ok: true, value: normalizeRebuyMode(value, defaults.allowRebuyMode) }
        case "rebuyWindowMs": {
            const result = normalizeDurationSetting(value, defaults.minWindowMs, defaults.maxWindowMs)
            if (!result.ok) return result
            return { ok: true, value: result.value }
        }
        case "actionTimeoutMs": {
            const result = normalizeDurationSetting(value, defaults.minActionTimeoutMs, defaults.maxActionTimeoutMs)
            if (!result.ok) return result
            return { ok: true, value: result.value }
        }
        case "autoCleanHands":
            return { ok: true, value: normalizeBoolean(value, defaults.autoCleanHands) }
        default:
            return { ok: false, reason: "unsupported-key" }
    }
}

const resolveTexasSettings = ({ overrides = {} } = {}) => {
    const enabled = normalizeBoolean(
        overrides.enabled,
        defaults.enabled
    )

    const allowRebuyMode = normalizeRebuyMode(
        overrides.allowRebuyMode !== undefined
            ? overrides.allowRebuyMode
            : overrides.allowRebuy,
        defaults.allowRebuyMode
    )

    const rebuyWindowMs = clampNumber(
        overrides.rebuyWindowMs ?? defaults.rebuyWindowMs,
        defaults.minWindowMs,
        defaults.maxWindowMs,
        defaults.rebuyWindowMs
    )

    const actionTimeoutMs = clampNumber(
        overrides.actionTimeoutMs ?? defaults.actionTimeoutMs,
        defaults.minActionTimeoutMs,
        defaults.maxActionTimeoutMs,
        defaults.actionTimeoutMs
    )

    const autoCleanHands = normalizeBoolean(
        overrides.autoCleanHands,
        defaults.autoCleanHands
    )

    return {
        enabled,
        allowRebuyMode,
        rebuyWindowMs,
        actionTimeoutMs,
        autoCleanHands
    }
}

module.exports = {
    gameId: "texas",
    supportedKeys: SUPPORTED_KEYS,
    defaults,
    resolveTexasSettings,
    resolveSettings: resolveTexasSettings,
    normalizeSetting: normalizeTexasSetting
}
