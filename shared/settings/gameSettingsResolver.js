const logger = require("../logger")
const { getGameDefinition } = require("./games")

const sanitizeLayer = (gameDef, layer = {}) => {
    if (!layer || typeof layer !== "object") return {}
    const cleaned = {}
    for (const key of gameDef.supportedKeys || []) {
        if (layer[key] === undefined) continue
        const normalized = gameDef.normalizeSetting(key, layer[key])
        if (normalized?.ok) {
            cleaned[key] = normalized.value
        }
    }
    return cleaned
}

const createGameSettingsResolver = ({ settingsStore, logger: providedLogger = logger } = {}) => {
    const log = providedLogger || console

    const mergeLayers = ({ game, layers = {}, lobbyOverrides = {} } = {}) => {
        const gameDef = typeof game === "object" ? game : getGameDefinition(game)
        if (!gameDef) {
            throw new Error(`Unsupported game '${game}' for settings resolution`)
        }

        const defaultsLayer = sanitizeLayer(gameDef, layers.defaults ?? gameDef.defaults)
        const guildLayer = sanitizeLayer(gameDef, layers.guild)
        const channelLayer = sanitizeLayer(gameDef, layers.channel)
        const lobbyLayer = sanitizeLayer(gameDef, lobbyOverrides)

        // Channel can override guild (positive or negative).
        // If channel explicitly sets enabled, that wins over guild.
        // Lobby cannot override persistent settings.
        const channelHasExplicitEnabled = Object.prototype.hasOwnProperty.call(layers.channel || {}, "enabled")
        const guildDisabled = guildLayer.enabled === false
        const channelDisabled = channelLayer.enabled === false

        // Disabled if: channel explicitly disables, OR guild disables without channel override
        const persistentDisabled = channelDisabled || (guildDisabled && !channelHasExplicitEnabled)

        const mergedOverrides = {
            ...defaultsLayer,
            ...guildLayer,
            ...channelLayer,
            ...lobbyLayer
        }

        // Lobby cannot re-enable a persistently disabled game
        if (persistentDisabled) {
            mergedOverrides.enabled = false
        }

        const resolveSettings = gameDef.resolveSettings || gameDef.resolveTexasSettings || gameDef.resolveBlackjackSettings
        if (typeof resolveSettings !== "function") {
            throw new Error(`Missing resolver for game '${gameDef.gameId || game}'`)
        }

        const effectiveSettings = resolveSettings({ overrides: mergedOverrides }) || {}
        if (persistentDisabled) {
            effectiveSettings.enabled = false
        }

        return {
            game: gameDef.gameId || game,
            effectiveSettings,
            layers: {
                defaults: defaultsLayer,
                guild: guildLayer,
                channel: channelLayer,
                lobby: lobbyLayer
            },
            persistentDisabled
        }
    }

    const resolveGameSettings = async({
        game,
        guildId,
        channelId,
        lobbyOverrides = {},
        overrides
    } = {}) => {
        const gameDef = getGameDefinition(game)
        if (!gameDef) {
            throw new Error(`Unsupported game '${game}' for settings resolution`)
        }

        let persisted = overrides
        if (!persisted && settingsStore?.getOverrides) {
            try {
                persisted = await settingsStore.getOverrides({ game: gameDef.gameId, guildId, channelId })
            } catch (error) {
                log.warn?.("Failed to load persisted overrides", {
                    scope: "gameSettingsResolver",
                    game: gameDef.gameId,
                    error: error?.message
                })
            }
        }

        const merged = mergeLayers({
            game: gameDef,
            layers: {
                defaults: gameDef.defaults,
                guild: persisted?.guild,
                channel: persisted?.channel
            },
            lobbyOverrides
        })

        return {
            ...merged,
            metadata: persisted?.metadata
        }
    }

    return {
        resolveGameSettings,
        mergeLayers
    }
}

module.exports = {
    createGameSettingsResolver
}
