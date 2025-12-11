/**
 * messageManagement.js
 *
 * Responsibility: manage ephemeral messages, hole card reminders, and the action timeline.
 * Used by: TexasGame
 *
 * Note: handles message formatting and delivery, not game logic.
 */

const { EmbedBuilder, Colors, MessageFlags, AttachmentBuilder } = require("discord.js")
const logger = require("../../../shared/logger")
const setSeparator = require("../../../shared/utils/setSeparator")

const EPHEMERAL_TIMEOUT = 8000  // Centralized here for consistency

class MessageManagement {
    constructor(gameInstance) {
        this.game = gameInstance
        this.ephemeralTimeout = EPHEMERAL_TIMEOUT
    }

    /**
     * respondEphemeral(interaction, payload, options): send an ephemeral message.
     *
     * Auto-deletes after EPHEMERAL_TIMEOUT unless keepPermanent=true.
     * Used for: input validation, errors, confirmations.
     */
    async respondEphemeral(interaction, payload = {}, options = {}) {
        if (!interaction || typeof interaction.reply !== "function") return null

        const { keepPermanent = false } = options
        
        let normalizedPayload = { ...payload }
        if (typeof normalizedPayload.content === 'string' && (!normalizedPayload.embeds || normalizedPayload.embeds.length === 0)) {
            const content = normalizedPayload.content
            let color = Colors.Default
            if (content.includes("⚠️") || content.includes("⏸️")) color = Colors.Orange
            if (content.includes("❌")) color = Colors.Red
            if (content.includes("✅")) color = Colors.Green
            
            normalizedPayload.embeds = [new EmbedBuilder().setColor(color).setDescription(content)]
            delete normalizedPayload.content
        }

        const response = {
            flags: MessageFlags.Ephemeral,
            ...normalizedPayload
        }

        try {
            let message = null
            if (interaction.deferred || interaction.replied) {
                message = await interaction.followUp(response)
            } else {
                message = await interaction.reply(response)
            }

            // Auto-delete after timeout unless marked permanent
            if (message && !keepPermanent && typeof message.delete === "function") {
                setTimeout(() => {
                    message.delete().catch(() => null)
                }, this.ephemeralTimeout)
            }

            return message
        } catch (error) {
            logger.debug("Failed to send ephemeral response", {
                scope: "messageManagement",
                error: error.message
            })
            return null
        }
    }

    /**
     * buildActionTimeline(options): format the action timeline.
     *
     * Shows the most recent actions with timestamps.
     * Returns: formatted string.
     */
    buildActionTimeline(options = {}) {
        if (!Array.isArray(this.game.actionTimeline) || this.game.actionTimeline.length === 0) {
            return "No actions yet."
        }

        const lines = this.game.actionTimeline
            .map((entry) => {
                const actionLabel = this.formatActionEntry(entry)
                if (!actionLabel) return null
                const timeLabel = this.formatTimelineTime(entry.ts) || "--:--:--"
                return `[${timeLabel}] ${entry.label} - ${actionLabel}`.trim()
            })
            .filter(Boolean)

        if (!lines.length) {
            return "No actions yet."
        }

        const body = lines.map((line) => `- ${line}`).join("\n")
        return body
    }

    /**
     * formatActionEntry(entry): format a single action for display.
     *
     * Example: "CALL 100$", "RAISE 250$", "ALL-IN 500$".
     */
    formatActionEntry(entry) {
        if (!entry) return null

        const formatAmount = (value) => `${setSeparator(Math.max(0, value || 0))}$`
        const type = entry.type

        if (type === "fold") return "FOLD"
        if (type === "check") return "CHECK"
        if (type === "call") return `CALL ${formatAmount(entry.amount)}`
        if (type === "bet") {
            const label = entry.isBlind ? "BLIND" : "BET"
            return `${label} ${formatAmount(entry.amount)}`
        }
        if (type === "raise") return `RAISE ${formatAmount(entry.total ?? entry.amount)}`
        if (type === "allin") return `ALL-IN ${formatAmount(entry.total ?? entry.amount)}`

        return String(type).toUpperCase()
    }

    /**
     * formatTimelineTime(ts): format timestamp as HH:MM:SS.
     */
    formatTimelineTime(ts) {
        if (!Number.isFinite(ts)) return ""
        const date = new Date(ts)
        const hh = String(date.getHours()).padStart(2, "0")
        const mm = String(date.getMinutes()).padStart(2, "0")
        const ss = String(date.getSeconds()).padStart(2, "0")
        return `${hh}:${mm}:${ss}`
    }

    /**
     * sendHoleCardsReminder(player, options): send a reminder with the player's hole cards.
     *
     * Uses the interaction follow-up when available (no DM fallback).
     * Also shows win probability when the player has the subscription.
     *
     * Returns: boolean - delivered?
     */
    async sendHoleCardsReminder(player, options = {}) {
        if (!player || !Array.isArray(player.cards) || player.cards.length === 0) return false
        if (player.bot) return false

        const force = Boolean(options.force)
        if (!force && player.status?.lastReminderHand === this.game.hands) return false

        // Auto-clean previous hole card message when enabled
        if (this.game?.settings?.autoCleanHands && player.status?.holeCardMessage) {
            const { message, hand } = player.status.holeCardMessage
            if (hand < this.game.hands && message && typeof message.delete === "function") {
                try {
                    await message.delete().catch(() => null)
                } catch (_) { /* ignore */ }
            }
            player.status.holeCardMessage = null
        }

        const interaction = player.lastInteraction
        const canFollowUp = interaction && typeof interaction.followUp === "function"

        if (!canFollowUp) {
            logger.debug("No interaction available for player hole cards reminder", {
                scope: "messageManagement",
                playerId: player?.id
            })
        }

        // Try to reuse an existing panel if available
        const existingPanel = player.status?.holeCardPanel
        const shouldReusePanel = existingPanel && existingPanel.hand === this.game.hands && existingPanel.asset

        let panel = null
        if (shouldReusePanel) {
            panel = existingPanel.asset
        } else if (this.game.renderer) {
            panel = await this.game.renderer.createPlayerPanelAttachment(player, { revealCards: true })
        }

        logger.debug("Texas hole cards panel resolved", {
            scope: "messageManagement",
            playerId: player?.id,
            hand: this.game.hands,
            reused: Boolean(shouldReusePanel),
            bufferBytes: panel?.buffer?.length || 0
        })

        // Build embed
        const embed = new EmbedBuilder()
            .setColor(Colors.DarkBlue)
            .setTitle(`Your hole cards | Round#${this.game?.hands || 0}`)

        if (panel) {
            embed.setImage(`attachment://${panel.filename}`)
        }

        // Add probability field if the player has the insight perk
        const { hasWinProbabilityInsight } = require("../../utils/playerUpgrades")
        if (hasWinProbabilityInsight(player)) {
            const { buildProbabilityField } = require("../../utils/probabilityFormatter")
            const probabilityField = buildProbabilityField({
                win: player.status?.winProbability,
                tie: player.status?.tieProbability,
                lose: player.status?.loseProbability,
                samples: player.status?.probabilitySamples
            }, {
                title: "🔮 Win probability",
                winLabel: "🟢 Win",
                tieLabel: "🟡 Tie",
                loseLabel: "🔴 Lose"
            }) || {
                name: "🔮 Win probability",
                value: "Calculating...",
                inline: false
            }
            embed.addFields(probabilityField)
        }

        // Prepare payloads
        const ephemeralPayload = {
            embeds: [embed],
            files: panel ? [panel.attachment] : undefined,
            flags: MessageFlags.Ephemeral
        }

        // Send via interaction only (no DM fallback)
        let delivered = false
        if (canFollowUp) {
            try {
                const sent = await interaction.followUp(ephemeralPayload)
                delivered = true
                if (this.game?.settings?.autoCleanHands && player.status) {
                    player.status.holeCardMessage = { hand: this.game.hands, message: sent }
                }
            } catch (error) {
                logger.debug("Failed to send hole cards reminder via interaction", {
                    scope: "messageManagement",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }

        // No DM fallback - only send via interaction

        // Mark as sent
        if (delivered && player.status) {
            player.status.lastReminderHand = this.game.hands
            if (panel) {
                player.status.holeCardPanel = { hand: this.game.hands, asset: panel }
            }
        }

        if (!delivered) {
            logger.warn("Hole cards reminder not delivered", {
                scope: "messageManagement",
                playerId: player?.id
            })
        }

        return delivered
    }

    /**
     * remindAllPlayersHoleCards(): send hole card reminders to all players.
     *
     * Used at the start of a hand.
     */
    async remindAllPlayersHoleCards() {
        for (const player of this.game.players) {
            try {
                await this.sendHoleCardsReminder(player, { force: true })
            } catch (error) {
                logger.debug("Failed to send hole cards reminder", {
                    scope: "messageManagement",
                    playerId: player?.id,
                    error: error?.message
                })
            }
        }
    }
}

module.exports = MessageManagement
