const logger = require("./logger");

const pickProp = (source, ...candidates) => {
    if (!source) return undefined;

    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) {
            return source[key];
        }
    }

    return undefined;
};

const COMMAND_LOCALIZATION_FIELDS = [
    ["name_localizations", "nameLocalizations"],
    ["description_localizations", "descriptionLocalizations"]
];

const CHOICE_LOCALIZATION_FIELDS = [
    ["name_localizations", "nameLocalizations"],
    ["value_localizations", "valueLocalizations"]
];

const applyLocalizationFields = (source, target, fieldPairs) => {
    for (const pair of fieldPairs) {
        const [canonical, ...aliases] = pair;
        const value = pickProp(source, canonical, ...aliases);
        if (value !== undefined) {
            target[canonical] = value;
        }
    }
};

/**
 * Sort object keys recursively for deterministic JSON.stringify
 * @param {any} obj - Object to sort
 * @returns {any} Object with sorted keys
 */
function sortObjectKeys(obj) {
    if (obj === null || typeof obj !== "object") {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(sortObjectKeys);
    }

    return Object.keys(obj)
        .sort()
        .reduce((result, key) => {
            result[key] = sortObjectKeys(obj[key]);
            return result;
        }, {});
}

/**
 * Remove undefined/null values from object recursively
 * @param {any} obj - Object to clean
 * @returns {any} Cleaned object
 */
function removeUndefined(obj) {
    if (obj === null || obj === undefined) {
        return undefined;
    }

    if (Array.isArray(obj)) {
        return obj.map(removeUndefined).filter(x => x !== undefined);
    }

    if (typeof obj === "object") {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanedValue = removeUndefined(value);
            if (cleanedValue !== undefined) {
                cleaned[key] = cleanedValue;
            }
        }
        return cleaned;
    }

    return obj;
}

/**
 * Normalize a command object for comparison
 * Discord returns commands with extra fields we don't care about
 * @param {Object} cmd - Command object
 * @returns {Object} Normalized command
 */
function normalizeCommand(cmd) {
    const normalized = {
        name: cmd.name,
        description: cmd.description,
        type: cmd.type || 1 // CHAT_INPUT = 1
    };

    applyLocalizationFields(cmd, normalized, COMMAND_LOCALIZATION_FIELDS);

    const options = normalizeOptions(pickProp(cmd, "options") || []);
    normalized.options = options;

    const defaultPermissions = pickProp(cmd, "default_member_permissions", "defaultMemberPermissions");
    if (defaultPermissions !== undefined && defaultPermissions !== null) {
        normalized.default_member_permissions = defaultPermissions;
    }

    const dmPermission = pickProp(cmd, "dm_permission", "dmPermission");
    const effectiveDmPermission = dmPermission ?? true;
    if (effectiveDmPermission !== true) {
        normalized.dm_permission = effectiveDmPermission;
    }

    return removeUndefined(normalized);
}

function normalizeOptions(options) {
    if (!Array.isArray(options) || options.length === 0) {
        return [];
    }

    return options.map(opt => {
        const option = {
            name: opt.name,
            description: opt.description,
            type: opt.type
        };

        applyLocalizationFields(opt, option, COMMAND_LOCALIZATION_FIELDS);

        const required = pickProp(opt, "required");
        option.required = required !== undefined ? required : false;

        const autocomplete = pickProp(opt, "autocomplete");
        option.autocomplete = autocomplete !== undefined ? autocomplete : false;

        const choices = normalizeChoices(pickProp(opt, "choices"));
        if (choices) {
            option.choices = choices;
        }

        const nestedOptions = normalizeOptions(pickProp(opt, "options") || []);
        if (nestedOptions.length > 0) {
            option.options = nestedOptions;
        }

        const minValue = pickProp(opt, "min_value", "minValue");
        if (minValue !== undefined) {
            option.min_value = minValue;
        }

        const maxValue = pickProp(opt, "max_value", "maxValue");
        if (maxValue !== undefined) {
            option.max_value = maxValue;
        }

        const minLength = pickProp(opt, "min_length", "minLength");
        if (minLength !== undefined) {
            option.min_length = minLength;
        }

        const maxLength = pickProp(opt, "max_length", "maxLength");
        if (maxLength !== undefined) {
            option.max_length = maxLength;
        }

        const channelTypes = pickProp(opt, "channel_types", "channelTypes");
        if (channelTypes !== undefined) {
            option.channel_types = channelTypes;
        }

        return option;
    });
}

function normalizeChoices(choices) {
    if (!Array.isArray(choices) || choices.length === 0) {
        return undefined;
    }

    return choices.map(choice => {
        const normalized = {
            name: choice.name,
            value: choice.value
        };
        applyLocalizationFields(choice, normalized, CHOICE_LOCALIZATION_FIELDS);
        return normalized;
    });
}

/**
 * Deep comparison of two command objects
 * @param {Object} cmd1 - First command (from Discord)
 * @param {Object} cmd2 - Second command (our payload)
 * @returns {boolean} True if commands are equivalent
 */
function areCommandsEqual(cmd1, cmd2) {
    // Normalize both commands for fair comparison
    const norm1 = normalizeCommand(cmd1);
    const norm2 = normalizeCommand(cmd2);

    // Sort keys recursively for deterministic comparison
    const sorted1 = sortObjectKeys(norm1);
    const sorted2 = sortObjectKeys(norm2);

    return JSON.stringify(sorted1) === JSON.stringify(sorted2);
}

/**
 * Compare two arrays of commands and identify changes
 * @param {Array} existingCommands - Commands currently registered on Discord
 * @param {Array} newCommands - Commands we want to register
 * @returns {Object} Analysis of command changes
 */
function diffCommands(existingCommands, newCommands) {
    const existing = new Map(existingCommands.map(cmd => [cmd.name, cmd]));
    const desired = new Map(newCommands.map(cmd => [cmd.name, cmd]));

    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    // Find added and modified commands
    for (const [name, newCmd] of desired) {
        const existingCmd = existing.get(name);

        if (!existingCmd) {
            added.push(name);
        } else if (!areCommandsEqual(existingCmd, newCmd)) {
            modified.push(name);
        } else {
            unchanged.push(name);
        }
    }

    // Find removed commands
    for (const [name] of existing) {
        if (!desired.has(name)) {
            removed.push(name);
        }
    }

    const hasChanges = added.length > 0 || removed.length > 0 || modified.length > 0;

    return {
        hasChanges,
        added,
        removed,
        modified,
        unchanged,
        summary: {
            total: desired.size,
            changed: added.length + removed.length + modified.length,
            unchanged: unchanged.length
        }
    };
}

/**
 * Log the diff results in a readable format
 * @param {Object} diff - Diff results from diffCommands()
 * @param {string} scope - Logging scope (e.g., "global" or "guild:123")
 */
function logDiff(diff, scope) {
    if (!diff.hasChanges) {
        logger.info(`No command changes detected`, {
            scope: "commandDiff",
            target: scope,
            total: diff.summary.total,
            icon: "✓"
        });
        return;
    }

    logger.info(`Command changes detected`, {
        scope: "commandDiff",
        target: scope,
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        unchanged: diff.unchanged.length,
        icon: "🔄"
    });

    if (diff.added.length > 0) {
        logger.debug(`Added commands: ${diff.added.join(", ")}`, {
            scope: "commandDiff",
            target: scope
        });
    }

    if (diff.removed.length > 0) {
        logger.debug(`Removed commands: ${diff.removed.join(", ")}`, {
            scope: "commandDiff",
            target: scope
        });
    }

    if (diff.modified.length > 0) {
        logger.debug(`Modified commands: ${diff.modified.join(", ")}`, {
            scope: "commandDiff",
            target: scope
        });
    }
}

module.exports = {
    areCommandsEqual,
    diffCommands,
    logDiff
};
