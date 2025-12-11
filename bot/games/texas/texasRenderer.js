/**
 * texasRenderer.js
 *
 * Responsibility: rendering helpers (updateGameMessage, captureTableRender, createPlayerPanelAttachment).
 * Used by: TexasGame
 *
 * Note: reads game state without changing its shape (only render metadata).
 */

const { AttachmentBuilder, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js")
const logger = require("../../../shared/logger")
const setSeparator = require("../../../shared/utils/setSeparator")
const { renderTexasTable, renderTexasPlayerPanel, createTexasTableState } = require("../../rendering/texasTableRenderer")

class GameRenderer {
    constructor(gameInstance) {
        this.game = gameInstance
        this.lastValidSnapshot = null  // Cache for frozen renders
    }

    /**
     * buildPlayerRenderPayload(player, options): create the payload to render a player.
     *
     * Returns: object with all info needed for rendering.
     */
    buildPlayerRenderPayload(player, options = {}) {
        if (!player) return null

        const reveal = Boolean(options.showdown || options.revealCards)

        return {
            id: player.id,
            label: player.tag || player.username,
            cards: Array.isArray(player.cards) ? [...player.cards] : [],
            stack: player.stack,
            bet: player.bets?.current ?? 0,
            totalBet: player.bets?.total ?? 0,
            winnings: player.status?.won?.grossValue ?? 0,
            gold: player.status?.won?.goldEarned ?? 0,
            folded: Boolean(player.status?.folded),
            allIn: Boolean(player.status?.allIn),
            eliminated: Boolean(player.status?.removed),
            leftDuringPlay: Boolean(player.status?.leftThisHand),
            pendingRebuy: Boolean(player.status?.pendingRebuy),
            handRank: player.hand?.name || null,
            lastAction: player.status?.lastAction || null,
            allInAmount: player.status?.allIn
                ? Math.max(player.status?.lastAllInAmount || player.bets?.total || 0, 0)
                : null,
            showCards: reveal
        }
    }

    /**
     * createPlayerPanelAttachment(player, options): create a PNG panel for a player.
     *
     * Used for: hole card reminders, showdown reveals.
     * Returns: { filename, buffer, attachment } | null
     */
    async createPlayerPanelAttachment(player, options = {}) {
        const payload = this.buildPlayerRenderPayload(player, {
            showdown: Boolean(options.showdown),
            revealCards: Boolean(options.revealCards),
            focusPlayerId: player?.id
        })
        if (!payload) return null

        let buffer = null
        try {
            buffer = await renderTexasPlayerPanel({ player: payload })
        } catch (error) {
            logger.warn("Texas player panel render failed", {
                scope: "gameRenderer",
                playerId: player?.id,
                error: error?.message
            })
            return null
        }

        if (!buffer || buffer.length === 0) {
            logger.warn("Texas player panel render returned empty buffer, retrying", {
                scope: "gameRenderer",
                playerId: player?.id
            })
            // Retry with small delay
            await new Promise(r => setTimeout(r, 100))
            try {
                buffer = await renderTexasPlayerPanel({ player: payload })
            } catch (error) {
                logger.warn("Texas player panel render retry failed", {
                    scope: "gameRenderer",
                    playerId: player?.id,
                    error: error?.message
                })
                return null
            }
        }

        if (!buffer || buffer.length === 0) {
            logger.warn("Texas player panel render still empty after retry", {
                scope: "gameRenderer",
                playerId: player?.id
            })
            return null
        }

        const filename = `texas_player_${player?.id || "unknown"}_${Date.now()}.png`
        logger.debug("Texas player panel rendered successfully", {
            scope: "gameRenderer",
            playerId: player?.id,
            bufferBytes: buffer?.length || 0
        })

        return {
            filename,
            buffer,
            attachment: new AttachmentBuilder(buffer, { name: filename, description: payload.label })
        }
    }

    /**
     * getDisplayedPotValue(): calculate the total pot to display.
     */
    getDisplayedPotValue() {
        const settled = this.game.bets.pots.reduce((sum, pot) => sum + pot.amount, 0)
        return settled + this.game.bets.total
    }

    /**
     * captureTableRender(options): render the table state as a PNG.
     *
     * Options: { title, showdown, focusPlayerId, revealFocusCards, revealPlayerIds }
     * Returns: { attachment, filename } | null
     */
    async captureTableRender(options = {}) {
        const tableMinBet = this.game.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))

        const stage = this.game.tableCards.length === 0
            ? "Pre-Flop"
            : this.game.tableCards.length === 3
                ? "Flop"
                : this.game.tableCards.length === 4
                    ? "Turn"
                    : this.game.tableCards.length >= 5
                        ? "River"
                        : "Showdown"

        const sidePotsSource = Array.isArray(this.game.bets?.pots) ? this.game.bets.pots : []

        const state = createTexasTableState({
            boardCards: [...this.game.tableCards],
            potTotal: this.getDisplayedPotValue(),
            sidePots: sidePotsSource.map((pot) => ({
                amount: pot?.amount || 0,
                winners: (pot?.winners || []).map((winner) => {
                    if (!winner) return null
                    if (winner.player?.id) return winner.player.id
                    return winner.id ?? null
                })
            })),
            round: this.game.hands,
            stage,
            blinds: `${setSeparator(smallBlind)} / ${setSeparator(tableMinBet)}`,
            players: this.game.players
                .map((player) => this.buildPlayerRenderPayload(player, {
                    showdown: Boolean(options.showdown),
                    focusPlayerId: options.focusPlayerId
                }))
                .filter(Boolean)
        }, {
            title: options.title || `Round #${this.game.hands}`,
            focusPlayerId: options.focusPlayerId,
            showdown: Boolean(options.showdown),
            revealFocusCards: Boolean(options.revealFocusCards),
            revealPlayerIds: Array.isArray(options.revealPlayerIds) ? options.revealPlayerIds : null
        })

        const attemptRender = async () => {
            const buffer = await renderTexasTable({ sanitizedParams: state, outputFormat: "png" })
            const filename = `texas_table_${this.game.hands}_${Date.now()}.png`
            return {
                attachment: new AttachmentBuilder(buffer, { name: filename, description: "Texas Hold'em Table" }),
                filename
            }
        }

        try {
            return await attemptRender()
        } catch (error) {
            logger.warn("Failed to render Texas table, retrying once", { error: error?.message })
            try {
                return await attemptRender()
            } catch (error2) {
                logger.error("Failed to render Texas table after retry", { error: error2?.message })
                return null
            }
        }
    }

    /**
     * updateGameMessage(player, options): build the game message payload for a player.
     *
     * Creates an embed with info, a table snapshot, and action buttons.
     * Keeps a frozen snapshot when only one player remains.
     *
     * Note: lightweight helper; the rest of the logic lives in texasGame.Action.
     */
    async getGameMessageSnapshot(player, options = {}) {
        // Frozen render when only one player remains
        let snapshot = null
        if (this.game.inGamePlayers.length >= 2) {
            snapshot = await this.captureTableRender({
                title: `${player.tag}'s turn`,
                focusPlayerId: player.id
            })
            if (snapshot) {
                this.lastValidSnapshot = snapshot
            }
        } else if (this.lastValidSnapshot) {
            // Reuse the last valid snapshot
            snapshot = this.lastValidSnapshot
        }

        return snapshot
    }

    /**
     * buildGameMessageEmbed(player, options): construct the main embed for the message.
     *
     * Shows: title, round, blind info, timeline.
     */
    buildGameMessageEmbed(player, options = {}) {
        const toCall = Math.max(0, this.game.bets.currentMax - player.bets.current)
        const paused = Boolean(options.remotePaused || (this.game.isRemotePauseActive && this.game.isRemotePauseActive()))

        const embed = new EmbedBuilder()
            .setColor(paused ? Colors.DarkGrey : Colors.Blue)
            .setTitle(`Texas Hold'em - Round #${this.game.hands}`)

        // Footer with info
        const footerParts = [
            `Round #${this.game.hands}`,
            `${Math.round(this.game.actionTimeoutMs / 1000)}s per turn`
        ]
        if (paused) {
            footerParts.push("Remote pause active")
        }
        if (this.game.inactiveHands >= 1 && !this.game.currentHandHasInteraction) {
            footerParts.push("⚠️ No recent actions: table may close soon")
        }
        embed.setFooter({ text: footerParts.join(" | ") })

        // Info field with blinds
        const tableMinBet = this.game.getTableMinBet()
        const smallBlind = Math.max(1, Math.floor(tableMinBet / 2))
        const bigBlind = tableMinBet
        const { sbPlayer, bbPlayer } = typeof this.game.getBlindAssignments === "function"
            ? this.game.getBlindAssignments()
            : { sbPlayer: this.game.inGamePlayers[0], bbPlayer: this.game.inGamePlayers[1] }
        const sbInfo = sbPlayer ? `<@${sbPlayer.id}> (${setSeparator(smallBlind)}$)` : `(${setSeparator(smallBlind)}$)`
        const bbInfo = bbPlayer ? `<@${bbPlayer.id}> (${setSeparator(bigBlind)}$)` : `(${setSeparator(bigBlind)}$)`

        const timeline = options.timeline || "No actions yet."

        embed.addFields(
            {
                name: "ℹ️ Info",
                value: `SB: ${sbInfo}\nBB: ${bbInfo}`,
                inline: true
            },
            {
                name: "📜 Timeline",
                value: timeline,
                inline: true
            }
        )

        if (paused) {
            embed.setDescription("⏸️ Table paused by admins. Please wait.")
        }

        return embed
    }
}

module.exports = GameRenderer
