const { AttachmentBuilder } = require("discord.js")
const logger = require("../../../shared/logger")

class GameBroadcaster {
    constructor(game) {
        this.game = game
        this.targets = new Map()
        this.collectors = new Map()
        this.primaryChannelId = null
        this.collectorsInitialized = new Set()
        this.collectorConfig = null
    }

    setPrimaryChannel(channel) {
        if (!channel?.id) return
        this.primaryChannelId = channel.id
        this.addTarget(channel)
    }

    inheritLobbyMirrors(lobbySession) {
        if (!lobbySession || !lobbySession.mirrors) return
        
        for (const [channelId, message] of lobbySession.mirrors) {
            if (message && message.channel) {
                this.addTarget(message.channel)
            }
        }
    }

    addTarget(channel) {
        if (!channel?.id) return
        if (this.targets.has(channel.id)) return

        this.targets.set(channel.id, {
            channel: channel,
            message: null
        })
    }

    async broadcast(payload, options = {}) {
        const { fresh = false, cleanupOld = false } = options || {}
        let primaryMessage = null

        const basePayload = { ...payload }
        if (!basePayload.allowedMentions) {
            basePayload.allowedMentions = { parse: [] }
        }

        const files = basePayload.files || []
        delete basePayload.files

        const attachmentDataCache = files.map(f => {
            if (f instanceof AttachmentBuilder) {
                const rawData = f.attachment
                let masterBuffer
                if (Buffer.isBuffer(rawData)) {
                    masterBuffer = Buffer.allocUnsafe(rawData.length)
                    rawData.copy(masterBuffer)
                } else if (rawData instanceof Uint8Array) {
                    masterBuffer = Buffer.from(rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength))
                } else {
                    masterBuffer = rawData
                }
                return {
                    type: 'attachment',
                    buffer: masterBuffer,
                    name: f.name,
                    description: f.description
                }
            }
            return { type: 'other', data: f }
        })

        for (const [channelId, target] of this.targets) {
            try {
                const previousMessage = target.message
                if (fresh && previousMessage) {
                    this.#disposeCollector(channelId, "replaced")
                }

                const targetPayload = { ...basePayload }

                if (attachmentDataCache.length > 0) {
                    targetPayload.files = attachmentDataCache.map(item => {
                        if (item.type === 'attachment') {
                            const channelBuffer = Buffer.allocUnsafe(item.buffer.length)
                            item.buffer.copy(channelBuffer)
                            return new AttachmentBuilder(channelBuffer, {
                                name: item.name,
                                description: item.description
                            })
                        }
                        return item.data
                    })
                }

                const finalPayload = attachmentDataCache.length > 0 ? {
                    embeds: targetPayload.embeds || [],
                    components: targetPayload.components || [],
                    files: targetPayload.files,
                    allowedMentions: targetPayload.allowedMentions
                } : targetPayload

                if (!target.message || fresh) {
                    const newMessage = await target.channel.send(finalPayload)
                    if (cleanupOld && previousMessage && typeof previousMessage.delete === "function") {
                        previousMessage.delete().catch(() => null)
                    }
                    target.message = newMessage
                    this.collectorsInitialized.delete(channelId)
                    if (this.collectorConfig) {
                        this.#ensureCollectorForTarget(channelId, target)
                    }
                } else {
                    if (attachmentDataCache.length > 0) {
                        await target.message.edit({
                            embeds: finalPayload.embeds,
                            components: finalPayload.components,
                            attachments: []
                        })
                        await target.message.edit(finalPayload)
                    } else {
                        await target.message.edit(finalPayload)
                    }
                }

                if (channelId === this.primaryChannelId) {
                    primaryMessage = target.message
                }
            } catch (error) {
                this.#handleBroadcastError(channelId, error)
            }
        }

        return primaryMessage
    }

    async notify(payload) {
        const safePayload = { 
            ...payload, 
            allowedMentions: { parse: [] } 
        }

        const promises = []
        for (const [channelId, target] of this.targets) {
            promises.push(
                target.channel.send(safePayload).catch(err => 
                    this.#handleBroadcastError(channelId, err)
                )
            )
        }
        await Promise.all(promises)
    }

    createCollectors(options, onCollect, onEnd) {
        this.stopCollectors()
        this.collectorConfig = { options, onCollect, onEnd }

        for (const [channelId, target] of this.targets) {
            if (!target.message) continue
            this.#ensureCollectorForTarget(channelId, target)
        }
    }

    #ensureCollectorForTarget(channelId, target) {
        if (!target.message) return
        if (this.collectorsInitialized.has(channelId)) return
        if (!this.collectorConfig) return

        const { options, onCollect, onEnd } = this.collectorConfig

        try {
            const collector = target.message.createMessageComponentCollector(options)

            collector.on("collect", async (i) => {
                try {
                    await onCollect(i)
                } catch (err) {
                    logger.error("Collector handler error", {
                        scope: "gameBroadcaster",
                        error: err.message
                    })
                }
            })

            if (onEnd && channelId === this.primaryChannelId) {
                collector.on("end", (collected, reason) => {
                    try {
                        onEnd(collected, reason)
                    } catch (err) {
                        logger.error("Collector onEnd handler failed", {
                            scope: "gameBroadcaster",
                            error: err.message
                        })
                    }
                })
            }

            this.collectors.set(channelId, collector)
            this.collectorsInitialized.add(channelId)
        } catch (error) {
            logger.warn("Failed to create collector", {
                scope: "gameBroadcaster",
                channelId,
                error: error.message
            })
        }
    }

    stopCollectors(reason = "cleanup") {
        for (const collector of this.collectors.values()) {
            if (!collector.ended) {
                try {
                    collector.stop(reason)
                } catch (_) {}
            }
        }
        this.collectors.clear()
        this.collectorsInitialized.clear()
        this.collectorConfig = null
    }

    #disposeCollector(channelId, reason = "replaced") {
        const collector = this.collectors.get(channelId)
        if (collector && !collector.ended) {
            try {
                collector.stop(reason)
            } catch (_) {}
        }
        this.collectors.delete(channelId)
        this.collectorsInitialized.delete(channelId)
    }

    cleanup() {
        this.stopCollectors()
        this.targets.clear()
    }

    #handleBroadcastError(channelId, error) {
        if ([10008, 50001, 50013].includes(error.code) || error.message?.includes("Missing Permissions")) {
            logger.warn("Target lost, removing from broadcast", { 
                scope: "gameBroadcaster", 
                channelId, 
                code: error.code 
            })
            this.targets.delete(channelId)
            const collector = this.collectors.get(channelId)
            if (collector) {
                collector.stop("target_lost")
                this.collectors.delete(channelId)
                this.collectorsInitialized.delete(channelId)
            }
        } else {
            logger.error("Broadcast error", { 
                scope: "gameBroadcaster", 
                channelId, 
                error: error.message 
            })
        }
    }
}

module.exports = GameBroadcaster
