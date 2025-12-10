const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js")
const logger = require("../../utils/logger")

/**
 * GameBroadcaster
 * 
 * Manages synchronized rendering of game state across multiple Discord channels.
 * Handles "mirrors" (messages in different channels showing the same game) and
 * aggregates interactions from all of them back to the game logic.
 */
class GameBroadcaster {
    constructor(game) {
        this.game = game
        // Map<channelId, { message: Message|null, channel: Channel }>
        this.targets = new Map()
        // Map<channelId, InteractionCollector>
        this.collectors = new Map()
        // The primary channel is always tracked separately to ensure it persists
        this.primaryChannelId = null
    }

    /**
     * Initializes the broadcaster with the primary game channel.
     * @param {Channel} channel 
     */
    setPrimaryChannel(channel) {
        if (!channel?.id) return
        this.primaryChannelId = channel.id
        this.addTarget(channel)
    }

    /**
     * Imports mirrors from a LobbySession before the game starts.
     * @param {LobbySession} lobbySession 
     */
    inheritLobbyMirrors(lobbySession) {
        if (!lobbySession || !lobbySession.mirrors) return
        
        for (const [channelId, message] of lobbySession.mirrors) {
            // We use the channel from the message
            if (message && message.channel) {
                // We don't reuse the lobby message itself for the game usually, 
                // as games typically send a fresh 'Game Started' message.
                // But we register the channel as a target.
                this.addTarget(message.channel)
            }
        }
    }

    /**
     * Adds a channel as a broadcast target.
     * @param {Channel} channel 
     */
    addTarget(channel) {
        if (!channel?.id) return
        if (this.targets.has(channel.id)) return

        this.targets.set(channel.id, {
            channel: channel,
            message: null,
            cleanup: false // Whether to delete message on end
        })
    }

    /**
     * Broadcasts a payload to all targets.
     * Updates existing messages or sends new ones if missing.
     * 
     * @param {Object} payload Discord message payload (embeds, components, files)
     * @returns {Promise<Message|null>} Returns the primary message
     */
    async broadcast(payload) {
        const promises = []
        let primaryMessage = null

        const basePayload = { ...payload }
        if (!basePayload.allowedMentions) {
            basePayload.allowedMentions = { parse: [] }
        }
        
        // Extract files to handle cloning
        const files = basePayload.files || []
        delete basePayload.files

        for (const [channelId, target] of this.targets) {
            const op = async () => {
                try {
                    // Clone payload for this target
                    const targetPayload = { ...basePayload }
                    
                    // Clone attachments if present to prevent reuse issues (e.g. consumed streams)
                    if (files.length > 0) {
                        targetPayload.files = files.map(f => {
                            if (f instanceof AttachmentBuilder) {
                                // Create new AttachmentBuilder with same buffer/stream and options
                                return new AttachmentBuilder(f.attachment, {
                                    name: f.name,
                                    description: f.description
                                })
                            }
                            return f
                        })
                    }

                    if (target.message) {
                        // Edit existing
                        await target.message.edit(targetPayload)
                    } else {
                        // Send new
                        target.message = await target.channel.send(targetPayload)
                    }

                    if (channelId === this.primaryChannelId) {
                        primaryMessage = target.message
                    }
                } catch (error) {
                    this.#handleBroadcastError(channelId, error)
                }
            }
            promises.push(op())
        }

        await Promise.all(promises)
        return primaryMessage
    }

    /**
     * Sends a notification (ephemeral-like or new message) to all targets.
     * Useful for "Player Left" or "Game Paused" notices that shouldn't replace the table.
     * 
     * @param {Object} payload 
     */
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

    /**
     * Creates interaction collectors on all active messages.
     * 
     * @param {Object} options Collector options (filter, time)
     * @param {Function} onCollect Callback for interactions
     * @param {Function} onEnd Callback when collector ends
     */
    createCollectors(options, onCollect, onEnd) {
        this.stopCollectors() // Clear old ones first

        for (const [channelId, target] of this.targets) {
            if (!target.message) continue

            try {
                const collector = target.message.createMessageComponentCollector(options)
                
                collector.on("collect", async (i) => {
                    // Centralize processing
                    try {
                        await onCollect(i)
                    } catch (err) {
                        logger.error("Collector handler error", { 
                            scope: "gameBroadcaster", 
                            error: err.message 
                        })
                    }
                })

                if (onEnd) {
                    collector.on("end", (collected, reason) => {
                        // We only trigger the main onEnd once, typically handled by the game logic 
                        // explicitly stopping, or we can use the primary channel's end.
                        // For now, we just let them run until stopped manually.
                    })
                }

                this.collectors.set(channelId, collector)
            } catch (error) {
                logger.warn("Failed to create collector", { 
                    scope: "gameBroadcaster", 
                    channelId, 
                    error: error.message 
                })
            }
        }
    }

    stopCollectors(reason = "cleanup") {
        for (const collector of this.collectors.values()) {
            if (!collector.ended) {
                try {
                    collector.stop(reason)
                } catch (e) { /* ignore */ }
            }
        }
        this.collectors.clear()
    }

    /**
     * Cleans up all messages (if flagged) and collectors.
     */
    cleanup() {
        this.stopCollectors()
        this.targets.clear()
    }

    #handleBroadcastError(channelId, error) {
        // Error code 10008: Unknown Message (deleted)
        // Error code 50001: Missing Access
        // Error code 50013: Missing Permissions
        if ([10008, 50001, 50013].includes(error.code) || error.message?.includes("Missing Permissions")) {
            logger.warn("Target lost, removing from broadcast", { 
                scope: "gameBroadcaster", 
                channelId, 
                code: error.code 
            })
            // If primary channel is lost, we might want to panic, but for now just remove target
            this.targets.delete(channelId)
            
            // Remove associated collector if any
            const collector = this.collectors.get(channelId)
            if (collector) {
                collector.stop("target_lost")
                this.collectors.delete(channelId)
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
