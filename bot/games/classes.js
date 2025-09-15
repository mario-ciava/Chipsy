const config = require("../../config");

const CLASS_TIERS = Object.freeze(
    (config.progression?.classes || []).map((tier) => ({
        name: tier.name,
        threshold: tier.threshold
    }))
);

const classes = Object.freeze(
    CLASS_TIERS.reduce((acc, tier) => {
        acc[tier.name] = tier.threshold;
        return acc;
    }, {})
);

function getUserClass(balance) {
    if (!Number.isFinite(balance) || balance < CLASS_TIERS[0].threshold) {
        return "NONE";
    }
    for (let i = CLASS_TIERS.length - 1; i >= 0; i--) {
        if (balance >= CLASS_TIERS[i].threshold) {
            return CLASS_TIERS[i].name;
        }
    }
    return "NONE";
}

module.exports = {
    classes,
    getUserClass,
    CLASS_TIERS
};
