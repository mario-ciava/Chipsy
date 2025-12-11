const { EventEmitter } = require("node:events")
const { MessageFlags, DiscordAPIError } = require("discord.js")
const config = require("../../config")
const { logAndSuppress } = require("../../shared/logger")
const { withAccessGuard } = require("../utils/interactionAccess")

class LobbySession extends EventEmitter {
    constructor({
        send,
        render,
        logger,
        collectorOptions = {},
        debounceDelay = config.lobby.debounceDelay.default,
        suppressNotifications = true,
        allowedMentions = { parse: [] }
    }) {
        super()
        if (typeof send !== "function") {
            throw new TypeError("LobbySession requires a send function")
        }
        if (typeof render !== "function") {
            throw new TypeError("LobbySession requires a render function")
        }

        this.send = send
        this.render = render
        this.logger = logger
        this.collectorOptions = {
            time: config.lobby.collectorTimeout.default,
            ...collectorOptions
        }
        this.debounceDelay = debounceDelay
        this.suppressNotifications = suppressNotifications
        this.allowedMentions = allowedMentions

        this.state = {
            status: "waiting",
            closed: false,
            visibility: "private",
            lobbyId: null
        }

        this.statusMessage = null
        this.mirrors = new Map()
        this.collector = null
        this.mirrorCollectors = new Map()
        this.scheduledRefresh = null
        this.autoTrigger = null
        this.componentHandlers = new Map()
        this.prefixHandlers = new Map()
        this.boundGame = null
    }

    get message() {
        return this.statusMessage
    }

    get isClosed() {
        return Boolean(this.state.closed)
    }

    updateState(partial = {}) {
        Object.assign(this.state, partial)
        return this.state
    }

    async open(initialState = {}) {
        this.updateState(initialState)
        const payload = this.#buildPayload()
        // Request the message back so we can create a collector on it
        this.statusMessage = await this.send({ ...payload, fetchReply: true })
        this.#createCollector()
        return this.statusMessage
    }

    async addMirror(channel) {
        if (this.isClosed) return null
        if (!channel || typeof channel.send !== "function") return null
        if (this.mirrors.has(channel.id)) return this.mirrors.get(channel.id)

        try {
            const payload = this.#buildPayload()
            const message = await channel.send(payload)
            this.mirrors.set(channel.id, message)
            this.#createCollectorForMessage(message, { isMirror: true })
            return message
        } catch (error) {
            this.#logError("Failed to add lobby mirror", error)
            return null
        }
    }

    registerComponentHandler(customId, handler) {
        if (typeof customId !== "string" || !customId.length) return this
        if (typeof handler !== "function") return this
        this.componentHandlers.set(customId, handler)
        return this
    }

    registerPrefixedHandler(prefix, handler) {
        if (typeof prefix !== "string" || !prefix.length) return this
        if (typeof handler !== "function") return this
        this.prefixHandlers.set(prefix, handler)
        return this
    }

    scheduleRefresh() {
        if (this.isClosed) return
        if (this.scheduledRefresh) return
        this.scheduledRefresh = setTimeout(() => {
            this.scheduledRefresh = null
            this.refresh().catch((error) => {
                this.#logError("Failed to refresh lobby", error)
            })
        }, this.debounceDelay)
    }

    async refresh(overrides = {}) {
        if (this.isClosed && !overrides.force) return
        
        const payload = this.#buildPayload(overrides)
        const promises = []

        if (this.statusMessage) {
            promises.push(
                this.statusMessage.edit(payload).catch((error) => {
                    this.#logError("Failed to edit lobby message", error)
                })
            )
        }

        for (const [channelId, message] of this.mirrors) {
            promises.push(
                message.edit(payload).catch((error) => {
                    this.#logError(`Failed to edit lobby mirror in ${channelId}`, error)
                    // If mirror fails (e.g. deleted), remove it
                    if (error.code === 10008) { // Unknown Message
                        this.#removeMirror(channelId)
                    }
                })
            )
        }

        await Promise.all(promises)
    }

    async close(options = {}) {
        if (this.isClosed) return
        this.state.closed = true
        if (options.status) {
            this.state.status = options.status
        }
        this.#clearScheduledRefresh()
        this.#clearAutoTrigger()
        
        if (this.collector && !this.collector.ended) {
            try {
                this.collector.stop(options.reason || "closed")
            } catch (error) {
                this.#logError("Failed to stop lobby collector", error)
            }
        }

        for (const [id, collector] of this.mirrorCollectors) {
            if (!collector.ended) {
                try {
                    collector.stop(options.reason || "closed")
                } catch (error) {
                    this.#logError(`Failed to stop mirror collector ${id}`, error)
                }
            }
        }
        this.mirrorCollectors.clear()

        await this.refresh({
            ...options.overrides,
            components: [],
            force: true
        })
    }

    startAutoTrigger(delayMs, callback) {
        if (!Number.isFinite(delayMs) || delayMs <= 0) return
        this.#clearAutoTrigger()
        this.autoTrigger = setTimeout(async() => {
            this.autoTrigger = null
            if (this.isClosed) return
            try {
                await callback?.()
            } catch (error) {
                this.#logError("Auto trigger callback failed", error)
            }
        }, delayMs)
    }

    clearAutoTrigger() {
        this.#clearAutoTrigger()
    }

    bindGame(game, { onStop } = {}) {
        if (!game || typeof game.Stop !== "function") return game
        this.boundGame = game
        const originalStop = game.Stop.bind(game)
        game.Stop = async(...args) => {
            let result
            try {
                result = await originalStop(...args)
            } finally {
                const [options] = args
                const reason = options?.reason
                const status = reason === "canceled" || reason === "error" ? "canceled" : "ended"
                await this.close({ status, reason }).catch((error) => {
                    this.#logError("Failed to close lobby during game stop", error)
                })
                if (typeof onStop === "function") {
                    try {
                        await onStop(...args)
                    } catch (error) {
                        this.#logError("onStop callback failed", error)
                    }
                }
            }
            return result
        }
        return game
    }

    async presentModal(interaction, modal, { filter, time = config.lobby.modalTimeout.default, autoAcknowledge = true } = {}) {
        if (!interaction || typeof interaction.showModal !== "function") {
            throw new TypeError("presentModal requires a valid interaction with showModal support")
        }
        if (!modal) {
            throw new TypeError("presentModal requires a modal instance")
        }

        if (interaction.deferred || interaction.replied) {
            return null
        }

        try {
            await interaction.showModal(modal)
        } catch (error) {
            if (error instanceof DiscordAPIError && error.code === 40060) {
                return null
            }
            this.#logError("Failed to show modal", error)
            throw error
        }

        if (!autoAcknowledge) return null

        try {
            const submission = await interaction.awaitModalSubmit({
                time,
                filter: withAccessGuard((modalInteraction) => {
                    if (typeof filter === "function") {
                        try {
                            return filter(modalInteraction)
                        } catch (_) {
                            return false
                        }
                    }
                    return modalInteraction.user?.id === interaction.user?.id
                }, { scope: "lobby:modal" })
            })
            return submission
        } catch (error) {
            if (error instanceof Error && error.message?.includes("no interactions")) {
                return null
            }
            throw error
        }
    }

    destroy() {
        this.#clearScheduledRefresh()
        this.#clearAutoTrigger()
        if (this.collector && !this.collector.ended) {
            try {
                this.collector.stop("destroyed")
            } catch (error) {
                this.#logError("Failed to stop lobby collector on destroy", error)
            }
        }
        this.removeAllListeners()
        this.statusMessage = null
        this.collector = null
        this.boundGame = null
    }

    #buildPayload({ components, overrides } = {}) {
        const context = {
            state: this.state,
            manager: this
        }
        const rendered = this.render(context) || {}
        const payload = {
            allowedMentions: this.allowedMentions,
            ...rendered
        }

        if (this.suppressNotifications) {
            payload.flags = MessageFlags.SuppressNotifications
        }

        if (components !== undefined) {
            payload.components = components
        } else if (!Array.isArray(payload.components)) {
            payload.components = []
        }

        if (overrides && typeof overrides === "object") {
            Object.assign(payload, overrides)
        }

        return payload
    }

    #createCollector() {
        if (!this.statusMessage) return
        const collector = this.#createCollectorForMessage(this.statusMessage)
        if (collector) {
            this.collector = collector
        }
    }

    #createCollectorForMessage(message, { isMirror = false } = {}) {
        if (!message) return null
        const baseFilter = (interaction) => {
            if (!interaction) return false
            if (interaction.user?.bot) return false
            if (typeof interaction.isMessageComponent === "function" && !interaction.isMessageComponent()) {
                return false
            }
            if (interaction.message?.id !== message.id) {
                return false
            }
            if (typeof this.collectorOptions.filter === "function") {
                return this.collectorOptions.filter(interaction)
            }
            return true
        }
        const filter = withAccessGuard(baseFilter, { scope: "lobby:collector" })
        const collector = message.createMessageComponentCollector({
            ...this.collectorOptions,
            filter
        })

        collector.on("collect", async(interaction) => {
            const handler = this.#resolveHandler(interaction.customId)
            if (!handler) {
                await interaction.deferUpdate().catch(
                    logAndSuppress("Failed to defer lobby component interaction", {
                        scope: "lobbySession",
                        messageId: message.id,
                        customId: interaction?.customId
                    })
                )
                return
            }
            try {
                await handler(interaction, this)
            } catch (error) {
                this.#logError("Component handler failed", error)
                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.followUp({
                            content: "❌ An unexpected error occurred.",
                            ephemeral: true
                        })
                    } else {
                        await interaction.reply({
                            content: "❌ An unexpected error occurred.",
                            ephemeral: true
                        })
                    }
                } catch (_) {
                    // ignore
                }
            }
        })

        collector.on("end", (collected, reason) => {
            if (!isMirror) {
                this.emit("end", { collected, reason })
            } else {
                this.mirrorCollectors.delete(message.channel.id)
            }
        })

        collector.on("error", (error) => {
            if (!isMirror) {
                this.emit("error", error)
            }
            this.#logError("Lobby collector error", error)
        })

        if (isMirror) {
            this.mirrorCollectors.set(message.channel.id, collector)
        }

        return collector
    }

    #removeMirror(channelId) {
        if (this.mirrorCollectors.has(channelId)) {
            const collector = this.mirrorCollectors.get(channelId)
            try {
                collector.stop("removed")
            } catch (error) {
                // ignore
            }
            this.mirrorCollectors.delete(channelId)
        }
        this.mirrors.delete(channelId)
    }

    #resolveHandler(customId = "") {
        if (this.componentHandlers.has(customId)) {
            return this.componentHandlers.get(customId)
        }
        for (const [prefix, handler] of this.prefixHandlers.entries()) {
            if (customId.startsWith(prefix)) {
                return handler
            }
        }
        return null
    }

    #clearScheduledRefresh() {
        if (this.scheduledRefresh) {
            clearTimeout(this.scheduledRefresh)
            this.scheduledRefresh = null
        }
    }

    #clearAutoTrigger() {
        if (this.autoTrigger) {
            clearTimeout(this.autoTrigger)
            this.autoTrigger = null
        }
    }

    #logError(message, error) {
        if (!this.logger || typeof this.logger.error !== "function") {
            return
        }
        this.logger.error(message, {
            scope: "lobbySession",
            error: error?.message,
            stack: error?.stack
        })
    }
}

module.exports = LobbySession
