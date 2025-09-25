const path = require("path")
const runtimeConfig = require("../../config")
const { logger: defaultLogger } = require("../middleware/structuredLogger")

const configModulePath = require.resolve("../../config")

const cloneSerializable = (value) => JSON.parse(JSON.stringify(value))

const snapshotConfig = (config) => ({
    discord: cloneSerializable(config.discord || {}),
    bot: cloneSerializable(config.bot || {}),
    mysql: cloneSerializable(config.mysql || {}),
    web: cloneSerializable(config.web || {}),
    testing: cloneSerializable(config.testing || {})
})

const flatten = (obj, prefix = []) => {
    if (obj === null || typeof obj !== "object") {
        return { [prefix.join(".") || "root"]: obj }
    }

    const entries = {}
    Object.entries(obj).forEach(([key, value]) => {
        const nextPrefix = [...prefix, key]
        if (value !== null && typeof value === "object") {
            Object.assign(entries, flatten(value, nextPrefix))
        } else {
            entries[nextPrefix.join(".")] = value
        }
    })
    return entries
}

const diffSnapshots = (previous, next) => {
    const prevFlat = flatten(previous)
    const nextFlat = flatten(next)
    const keys = new Set([...Object.keys(prevFlat), ...Object.keys(nextFlat)])
    const changes = []

    keys.forEach((key) => {
        if (prevFlat[key] !== nextFlat[key]) {
            changes.push({
                key,
                before: prevFlat[key],
                after: nextFlat[key]
            })
        }
    })

    return {
        total: changes.length,
        changedKeys: changes.map((entry) => entry.key),
        entries: changes
    }
}

const reloadConfigModule = () => {
    const cachedModule = require.cache[configModulePath]
    const currentExports = cachedModule?.exports || runtimeConfig

    delete require.cache[configModulePath]
    const freshConfig = require("../../config")
    const reloadedModule = require.cache[configModulePath]

    if (reloadedModule) {
        reloadedModule.exports = currentExports
    }

    Object.keys(currentExports).forEach((key) => {
        delete currentExports[key]
    })
    Object.assign(currentExports, freshConfig)

    return currentExports
}

const applyConfigToClient = (client, configSnapshot = {}) => {
    if (!client) return
    const previousEnabled = Boolean(client.config?.enabled)
    const nextConfig = {
        ...client.config,
        id: configSnapshot.discord?.clientId ?? client.config?.id,
        secret: configSnapshot.discord?.clientSecret ?? client.config?.secret,
        token: configSnapshot.discord?.botToken ?? client.config?.token,
        ownerid: configSnapshot.discord?.ownerId ?? client.config?.ownerid,
        owner: configSnapshot.discord?.ownerId ?? client.config?.owner,
        prefix: configSnapshot.bot?.prefix ?? client.config?.prefix,
        redirectUri: configSnapshot.web?.redirectOrigin ?? client.config?.redirectUri
    }
    nextConfig.enabled = previousEnabled
    client.config = nextConfig
}

const createRuntimeConfigService = ({ client, logger = defaultLogger } = {}) => {
    if (!client) {
        throw new Error("Discord client is required to manage runtime configuration")
    }

    let lastSnapshot = snapshotConfig(runtimeConfig)

    const reload = async(meta = {}) => {
        try {
            const previousSnapshot = lastSnapshot
            const updatedConfig = reloadConfigModule()
            const currentSnapshot = snapshotConfig(updatedConfig)
            const diff = diffSnapshots(previousSnapshot, currentSnapshot)

            applyConfigToClient(client, currentSnapshot)
            lastSnapshot = currentSnapshot

            logger.info("Runtime configuration reloaded", {
                scope: "configReload",
                changedKeys: diff.changedKeys,
                totalChanges: diff.total,
                actor: meta.actor || "unknown",
                reason: meta.reason
            })

            return {
                updatedAt: new Date().toISOString(),
                diff,
                snapshot: currentSnapshot
            }
        } catch (error) {
            logger.error("Failed to reload runtime configuration", {
                scope: "configReload",
                error: error.message
            })
            throw error
        }
    }

    return {
        reload
    }
}

module.exports = createRuntimeConfigService
