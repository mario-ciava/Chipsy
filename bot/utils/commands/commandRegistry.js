const fs = require("fs/promises")
const path = require("path")
const chokidar = require("chokidar")
const logger = require("../../../shared/logger")

const COMMAND_FILE_EXTENSION = ".js"

const defaultOptions = {
    watch: true,
    reloadDebounceMs: 750,
    syncOnChange: true,
    syncDebounceMs: 4000
}

class CommandRegistry {
    constructor({ client, commandsPath, options = {}, logger: injectedLogger = logger }) {
        if (!client) {
            throw new Error("CommandRegistry requires a Discord client instance")
        }

        this.client = client
        this.commandsPath = commandsPath || path.join(__dirname, "..", "..", "commands")
        this.logger = injectedLogger
        this.options = { ...defaultOptions, ...options }

        this.commandByFile = new Map()
        this.fileByCommand = new Map()
        this.serialPromise = Promise.resolve()

        this.watcher = null
        this.syncTimer = null
        this.pendingSyncReason = null
        this.syncAfterReadyReason = null

        this.lastReloadAt = null
        this.lastSyncAt = null
        this.initialized = false
    }

    async initialize() {
        if (this.initialized) {
            return this.getStats()
        }

        await this.reloadAll({ reason: "bootstrap", sync: false })
        this.initialized = true

        if (this.options.watch) {
            this.startWatcher()
        }

        return this.getStats()
    }

    async reloadAll({ reason = "manual-reload", sync = true } = {}) {
        return this.runExclusive(async() => {
            const files = await this.readCommandFiles()
            const errors = []
            let registered = 0

            for (const file of files) {
                try {
                    await this.loadCommandFromFile(file)
                    registered += 1
                } catch (error) {
                    errors.push({ file, error })
                }
            }

            this.lastReloadAt = new Date().toISOString()

            if (errors.length) {
                errors.forEach(({ file, error }) => {
                    this.logger.error("Failed to reload command file", {
                        scope: "commandRegistry",
                        file,
                        error: error?.message
                    })
                })
                const message = `Reload completed with ${errors.length} error(s)`
                const aggregate = new Error(message)
                aggregate.details = errors.map((value) => ({
                    file: path.basename(value.file),
                    error: value.error?.message ?? String(value.error)
                }))
                throw aggregate
            }

            this.logger.info("Commands reloaded from disk", {
                scope: "commandRegistry",
                registered,
                reason
            })

            if (sync) {
                await this.scheduleSync({ reason, immediate: true })
            }

            return this.getStats()
        })
    }

    async reloadFile(filePath, { reason = "file-change" } = {}) {
        const resolvedPath = path.resolve(filePath)
        if (!this.isCommandFile(resolvedPath)) {
            return null
        }

        return this.runExclusive(async() => {
            await this.loadCommandFromFile(resolvedPath)
            this.logger.debug("Command file reloaded", {
                scope: "commandRegistry",
                file: path.basename(resolvedPath),
                reason
            })
            await this.scheduleSync({ reason })
            return this.getStats()
        })
    }

    async removeFile(filePath, { reason = "file-removed" } = {}) {
        const resolvedPath = path.resolve(filePath)
        if (!this.isCommandFile(resolvedPath)) {
            return null
        }

        return this.runExclusive(async() => {
            const commandName = this.commandByFile.get(resolvedPath)
            if (commandName) {
                this.unregisterCommand(commandName, { reason })
                this.commandByFile.delete(resolvedPath)
            }
            this.logger.warn("Command file removed - command unregistered", {
                scope: "commandRegistry",
                file: path.basename(resolvedPath),
                command: commandName
            })
            await this.scheduleSync({ reason })
            return this.getStats()
        })
    }

    unregisterCommand(name, { reason = "manual" } = {}) {
        const normalized = this.normalizeCommandName(name)
        if (!normalized) return false

        const removed = this.client.commandRouter.unregister(normalized)
        if (removed) {
            const filePath = this.fileByCommand.get(normalized)
            if (filePath) {
                this.commandByFile.delete(filePath)
            }
            this.fileByCommand.delete(normalized)

            this.logger.info("Command unregistered", {
                scope: "commandRegistry",
                command: normalized,
                reason
            })
        }
        return removed
    }

    isCommandFile(filePath) {
        return typeof filePath === "string" && filePath.endsWith(COMMAND_FILE_EXTENSION)
    }

    async readCommandFiles() {
        const entries = await fs.readdir(this.commandsPath, { withFileTypes: true })
        return entries
            .filter(entry => entry.isFile() && entry.name.endsWith(COMMAND_FILE_EXTENSION))
            .map(entry => path.join(this.commandsPath, entry.name))
    }

    async loadCommandFromFile(filePath) {
        const resolvedPath = path.resolve(filePath)
        delete require.cache[require.resolve(resolvedPath)]

        const command = require(resolvedPath)
        this.assertValidCommand(command, resolvedPath)

        const name = this.normalizeCommandName(command.config.name)
        if (!name) {
            throw new Error(`Command at ${resolvedPath} is missing a valid name`)
        }

        const previousFile = this.fileByCommand.get(name)
        if (previousFile && previousFile !== resolvedPath) {
            this.commandByFile.delete(previousFile)
        }

        if (this.commandByFile.get(resolvedPath) && this.commandByFile.get(resolvedPath) !== name) {
            // Command renamed but file reused
            this.unregisterCommand(this.commandByFile.get(resolvedPath), { reason: "command-renamed" })
        }

        this.client.commandRouter.register(command, { replace: true })

        this.commandByFile.set(resolvedPath, name)
        this.fileByCommand.set(name, resolvedPath)

        return command
    }

    assertValidCommand(command, filePath) {
        if (!command || typeof command !== "object") {
            throw new Error(`Command file '${path.basename(filePath)}' did not export an object`)
        }
        if (!command.config) {
            throw new Error(`Command file '${path.basename(filePath)}' is missing the 'config' export`)
        }
        if (!command.config.name) {
            throw new Error(`Command file '${path.basename(filePath)}' is missing the 'config.name' field`)
        }
        if (!command.config.slashCommand || typeof command.config.slashCommand.toJSON !== "function") {
            throw new Error(`Command '${command.config.name}' is missing a valid SlashCommandBuilder`)
        }
        if (typeof command.execute !== "function") {
            throw new Error(`Command '${command.config.name}' is missing the 'execute' function`)
        }
    }

    normalizeCommandName(name) {
        if (!name || typeof name !== "string") return null
        return name.trim().toLowerCase()
    }

    startWatcher() {
        if (this.watcher) return

        this.watcher = chokidar.watch(this.commandsPath, {
            ignoreInitial: true,
            depth: 0,
            awaitWriteFinish: {
                stabilityThreshold: this.options.reloadDebounceMs,
                pollInterval: 100
            }
        })

        this.watcher
            .on("change", (filePath) => {
                this.reloadFile(filePath).catch((error) => {
                    this.logger.error("Hot reload failed", {
                        scope: "commandRegistry",
                        file: path.basename(filePath),
                        error: error?.message
                    })
                })
            })
            .on("add", (filePath) => {
                this.reloadFile(filePath, { reason: "file-added" }).catch((error) => {
                    this.logger.error("Failed to load new command file", {
                        scope: "commandRegistry",
                        file: path.basename(filePath),
                        error: error?.message
                    })
                })
            })
            .on("unlink", (filePath) => {
                this.removeFile(filePath).catch((error) => {
                    this.logger.error("Failed to unregister removed command file", {
                        scope: "commandRegistry",
                        file: path.basename(filePath),
                        error: error?.message
                    })
                })
            })

        this.logger.info("Command watcher started", {
            scope: "commandRegistry",
            path: this.commandsPath
        })
    }

    stopWatcher() {
        if (this.watcher) {
            this.watcher.close().catch(() => null)
            this.watcher = null
        }
    }

    async scheduleSync({ reason = "auto", immediate = false } = {}) {
        if (!this.options.syncOnChange) {
            return null
        }

        if (!this.client?.commandSync || typeof this.client.commandSync.synchronize !== "function") {
            this.logger.debug("Skipping command sync - sync service unavailable", {
                scope: "commandRegistry",
                reason
            })
            return null
        }

        if (!this.isClientReady()) {
            this.pendingSyncReason = reason
            if (!this.syncAfterReadyReason) {
                this.client.once("ready", () => {
                    const pendingReason = this.syncAfterReadyReason || "post-ready"
                    this.syncAfterReadyReason = null
                    this.scheduleSync({ reason: pendingReason, immediate: true }).catch(() => null)
                })
            }
            this.syncAfterReadyReason = reason
            return null
        }

        if (immediate) {
            return this.runSync(reason)
        }

        if (this.syncTimer) {
            clearTimeout(this.syncTimer)
        }

        this.syncTimer = setTimeout(() => {
            this.runSync(reason).catch(() => null)
            this.syncTimer = null
        }, this.options.syncDebounceMs)

        return null
    }

    async runSync(reason) {
        try {
            await this.client.commandSync.synchronize({ reason })
            this.lastSyncAt = new Date().toISOString()
            this.pendingSyncReason = null
            this.logger.info("Command sync completed", {
                scope: "commandRegistry",
                reason
            })
        } catch (error) {
            this.logger.error("Command sync failed", {
                scope: "commandRegistry",
                reason,
                error: error?.message
            })
            throw error
        }
    }

    isClientReady() {
        return Boolean(this.client && typeof this.client.isReady === "function" && this.client.isReady())
    }

    runExclusive(task) {
        const execute = async() => task()
        const next = this.serialPromise.then(execute, execute)
        this.serialPromise = next.catch(() => {})
        return next
    }

    getStats() {
        return {
            commandsTracked: this.client.commandRouter.commands?.size ?? 0,
            files: this.commandByFile.size,
            watching: Boolean(this.watcher),
            lastReloadAt: this.lastReloadAt,
            lastSyncAt: this.lastSyncAt
        }
    }

    getCommandSources() {
        return Array.from(this.commandByFile.entries()).map(([file, name]) => ({
            name,
            file
        }))
    }

    async shutdown() {
        this.stopWatcher()
        await this.serialPromise
        if (this.syncTimer) {
            clearTimeout(this.syncTimer)
            this.syncTimer = null
        }
    }
}

module.exports = CommandRegistry
