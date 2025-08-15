const BASE_REQUIRED_EXP = 100

const sanitizeLevel = (level) => {
    if (typeof level !== "number" || !Number.isFinite(level)) return 0
    const parsed = Math.floor(level)
    return parsed > 0 ? parsed : 0
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
    normalized.level = sanitizeLevel(normalized.level)

    if (typeof normalized.current_exp !== "number" || normalized.current_exp < 0 || !Number.isFinite(normalized.current_exp)) {
        if (typeof normalized.exp === "number" && Number.isFinite(normalized.exp) && normalized.exp >= 0) {
            normalized.current_exp = Math.floor(normalized.exp)
        } else {
            normalized.current_exp = 0
        }
    } else {
        normalized.current_exp = Math.floor(normalized.current_exp)
    }

    if (typeof normalized.required_exp !== "number" || normalized.required_exp <= 0 || !Number.isFinite(normalized.required_exp)) {
        normalized.required_exp = calculateRequiredExp(normalized.level)
    } else {
        normalized.required_exp = Math.floor(normalized.required_exp)
    }

    if (Object.prototype.hasOwnProperty.call(normalized, "exp")) {
        delete normalized.exp
    }

    return normalized
}

module.exports = {
    BASE_REQUIRED_EXP,
    calculateRequiredExp,
    normalizeUserExperience
}
