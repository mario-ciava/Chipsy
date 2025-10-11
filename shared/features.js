const setSeparator = require("./utils/setSeparator");
const config = require("../config");

const DEFAULT_LEVEL_REWARD = Object.freeze({
    base: 5000,
    multiplier: 16,
    adjustmentDivisor: 100
});

const UPGRADE_STRATEGIES = {
    "linear-subtract": (descriptor, baseValue, level, increment) => {
        const delta = Number.isFinite(increment) ? increment : descriptor.increment;
        let result = baseValue - delta * level;
        if (Number.isFinite(descriptor.precision)) {
            result = parseFloat(result.toFixed(descriptor.precision));
        }
        if (Number.isFinite(descriptor.minValue)) {
            result = Math.max(descriptor.minValue, result);
        }
        return result;
    },
    exponential: (descriptor, baseValue, level) => {
        const multiplier = descriptor.multiplier ?? 1;
        let result = baseValue;
        for (let i = 0; i < level; i++) {
            result = parseInt(result * multiplier, 10);
        }
        return result;
    }
};

function createDefinition(key, descriptor = {}) {
    const strategy = UPGRADE_STRATEGIES[descriptor.strategy] || UPGRADE_STRATEGIES["linear-subtract"];
    const startingCost = descriptor.startingCost ?? 0;
    const increase = descriptor.costGrowth ?? 0;
    const maxLevel = descriptor.maxLevel ?? 0;
    const originalValue = descriptor.baseValue ?? 0;
    const featureValue = descriptor.increment ?? descriptor.multiplier ?? descriptor.featureValue ?? 0;

    return Object.freeze({
        key,
        startingCost,
        increase,
        max: maxLevel,
        originalValue,
        featureValue,
        descriptor,
        apply: (baseValue, level, overrideIncrement) =>
            strategy(descriptor, baseValue, level, overrideIncrement ?? featureValue)
    });
}

const FEATURE_DEFINITIONS = Object.freeze(
    Object.entries(config.progression?.upgrades || {}).reduce((acc, [key, value]) => {
        acc[key] = createDefinition(key, value);
        return acc;
    }, {})
);

function getDefinition(featureKey) {
    return FEATURE_DEFINITIONS[featureKey];
}

function getCosts(featureKey, withoutSeparator = false) {
    const definition = getDefinition(featureKey);
    if (!definition) return null;

    const maxLevels = Math.max(Number(definition.max) || 10, 10);
    const costs = [definition.startingCost];

    for (let i = 0; i < maxLevels; i++) {
        const previous = costs[costs.length - 1];
        const next = previous + Math.round(Math.sqrt(previous) * definition.increase);
        costs.push(next);
    }

    if (withoutSeparator) {
        return costs;
    }
    return costs.map(value => setSeparator(value));
}

function get(featureKey) {
    return getDefinition(featureKey);
}

function getLevelReward(level) {
    const rewardConfig = config.progression?.levelReward ?? DEFAULT_LEVEL_REWARD;
    let reward = rewardConfig.base ?? DEFAULT_LEVEL_REWARD.base;
    const normalizedLevel = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    const divisor = rewardConfig.adjustmentDivisor || DEFAULT_LEVEL_REWARD.adjustmentDivisor;
    const multiplier = rewardConfig.multiplier || DEFAULT_LEVEL_REWARD.multiplier;

    for (let i = 0; i < normalizedLevel; i++) {
        reward += parseInt(Math.sqrt(reward + reward / divisor) * multiplier, 10);
    }
    return reward;
}

function applyUpgrades(featureKey, level, startingValue, featureVal) {
    const definition = getDefinition(featureKey);
    if (!definition) return startingValue;

    const normalizedLevel = Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
    const maxLevel = Number.isFinite(definition.max) ? definition.max : normalizedLevel;
    const safeLevel = Math.min(normalizedLevel, maxLevel);

    const baseValue = Number.isFinite(startingValue) ? startingValue : definition.originalValue;
    const increment = Number.isFinite(featureVal) ? featureVal : definition.featureValue;

    let result = definition.apply(baseValue, safeLevel, increment);
    if (!Number.isFinite(result)) {
        result = baseValue;
    }
    if (featureKey === "reward-time") {
        const minValue = definition.descriptor?.minValue;
        result = Number.isFinite(minValue) ? Math.max(minValue, result) : Math.max(1, result);
    }
    return result;
}

function inputConverter(rawInput) {
    if (rawInput === undefined || rawInput === null) {
        return undefined;
    }
    const input = String(rawInput).trim();
    if (!input) return undefined;

    const unit = input.slice(-1).toLowerCase();
    const hasUnit = ["k", "m", "b"].includes(unit);
    const numericPortion = hasUnit ? input.slice(0, -1) : input;
    const parsed = parseFloat(numericPortion);
    if (!Number.isFinite(parsed)) return undefined;

    const multipliers = { k: 1_000, m: 1_000_000, b: 1_000_000_000 };
    const multiplier = hasUnit ? multipliers[unit] : 1;
    const value = Math.floor(parsed * multiplier);
    return value !== 0 ? value : Math.floor(parsed);
}

module.exports = {
    list: FEATURE_DEFINITIONS,
    getCosts,
    get,
    getLevelReward,
    applyUpgrades,
    inputConverter
};
