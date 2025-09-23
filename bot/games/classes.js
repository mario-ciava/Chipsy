const config = require("../../config");

const CLASS_TIERS = Object.freeze(
    (config.progression?.classes || [])
        .map((tier) => ({
            name: tier.name,
            threshold: tier.threshold
        }))
        .sort((a, b) => a.threshold - b.threshold)
);

function getUserClass(balance) {
    if (CLASS_TIERS.length === 0) {
        return "NONE";
    }

    if (!Number.isFinite(balance)) {
        return CLASS_TIERS[0].name;
    }

    for (let i = CLASS_TIERS.length - 1; i >= 0; i--) {
        if (balance >= CLASS_TIERS[i].threshold) {
            return CLASS_TIERS[i].name;
        }
    }

    return CLASS_TIERS[0].name;
}

module.exports = {
    getUserClass
};
