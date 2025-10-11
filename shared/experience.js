const config = require("../config");
const { constants } = config;
const features = require("./features");

const BASE_REQUIRED_EXP = constants.experience.baseRequiredExp;
const DEFAULT_PLAYER_LEVEL = config.progression?.startingLevel ?? 1;

const SAFE_INTEGER_MAX = BigInt(Number.MAX_SAFE_INTEGER)

const toSafeInteger = (value, { defaultValue = 0, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const normalizedMin = Number.isFinite(min) ? Math.floor(min) : 0
    const normalizedMax = Number.isFinite(max) ? Math.floor(max) : Number.MAX_SAFE_INTEGER
    const fallback = Number.isFinite(defaultValue) ? Math.floor(defaultValue) : normalizedMin

    const clampBigInt = (input) => {
        const minBig = BigInt(normalizedMin)
        const maxBig = BigInt(Math.min(normalizedMax, Number.MAX_SAFE_INTEGER))
        let candidate = input

        if (candidate < minBig) candidate = minBig
        if (candidate > maxBig) candidate = maxBig

        if (candidate > SAFE_INTEGER_MAX) candidate = SAFE_INTEGER_MAX
        if (candidate < -SAFE_INTEGER_MAX) candidate = -SAFE_INTEGER_MAX

        const asNumber = Number(candidate)
        return Number.isFinite(asNumber) ? asNumber : fallback
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return clampBigInt(BigInt(Math.floor(value)))
    }

    if (typeof value === "bigint") {
        return clampBigInt(value)
    }

    if (typeof value === "string") {
        const trimmed = value.trim()
        if (trimmed.length === 0 || !/^-?\d+$/.test(trimmed)) {
            return clampBigInt(BigInt(fallback))
        }

        try {
            return clampBigInt(BigInt(trimmed))
        } catch {
            return clampBigInt(BigInt(fallback))
        }
    }

    return clampBigInt(BigInt(fallback))
}

const sanitizeLevel = (level) => {
    const normalized = toSafeInteger(level, { min: 0, defaultValue: DEFAULT_PLAYER_LEVEL })
    return normalized > 0 ? normalized : 0
}

const calculateRequiredExp = (level, base = BASE_REQUIRED_EXP) => {
    const sanitizedLevel = sanitizeLevel(level)
    let required = Math.max(0, base || 0)

    for (let i = 0; i < sanitizedLevel; i++) {
        const growth = Math.floor(Math.log(Math.pow(Math.max(required, 1), 3)) * 5)
        required += Number.isFinite(growth) && growth > 0 ? growth : 0
    }

    return required
}

const normalizeUserExperience = (userData = {}) => {
    const normalized = { ...userData }
    const sanitizedLevel = sanitizeLevel(normalized.level)
    normalized.level = sanitizedLevel >= DEFAULT_PLAYER_LEVEL ? sanitizedLevel : DEFAULT_PLAYER_LEVEL

    const hasCurrentExp = ["number", "string", "bigint"].includes(typeof normalized.current_exp)
    const hasLegacyExp = ["number", "string", "bigint"].includes(typeof normalized.exp)

    if (hasCurrentExp) {
        normalized.current_exp = toSafeInteger(normalized.current_exp, { defaultValue: 0, min: 0 })
    } else if (hasLegacyExp) {
        normalized.current_exp = toSafeInteger(normalized.exp, { defaultValue: 0, min: 0 })
    } else {
        normalized.current_exp = 0
    }

    const requiredFallback = calculateRequiredExp(normalized.level)
    const hasRequiredExp = ["number", "string", "bigint"].includes(typeof normalized.required_exp)
    if (hasRequiredExp) {
        const sanitized = toSafeInteger(normalized.required_exp, { defaultValue: requiredFallback, min: 0 })
        normalized.required_exp = sanitized > 0 ? sanitized : requiredFallback
    } else {
        normalized.required_exp = requiredFallback
    }

    const unsignedDefaults = {
        money: constants.database.defaultMoney,
        ...constants.database.defaultUserStats
    }

    for (const [key, defaultValue] of Object.entries(unsignedDefaults)) {
        normalized[key] = toSafeInteger(normalized[key], { defaultValue, min: 0 })
    }

    const upgradeFeatureMap = {
        withholding_upgrade: "with-holding",
        reward_amount_upgrade: "reward-amount",
        reward_time_upgrade: "reward-time"
    }

    for (const [upgradeKey, featureKey] of Object.entries(upgradeFeatureMap)) {
        const definition = features.get(featureKey)
        if (!definition) continue

        const maxLevel = Number.isFinite(definition.max) ? definition.max : undefined
        if (typeof maxLevel === "number") {
            normalized[upgradeKey] = Math.min(normalized[upgradeKey], maxLevel)
        }
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "exp")) {
        delete normalized.exp
    }

    return normalized
}

module.exports = {
    BASE_REQUIRED_EXP,
    DEFAULT_PLAYER_LEVEL,
    calculateRequiredExp,
    normalizeUserExperience
}
