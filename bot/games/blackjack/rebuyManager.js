const { EmbedBuilder, Colors, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js")
const features = require("../../../shared/features")
const bankrollManager = require("../../utils/bankrollManager")
const setSeparator = require("../../../shared/utils/setSeparator")
const { withAccessGuard } = require("../../utils/interactionAccess")
const logger = require("../../../shared/logger")
const config = require("../../../config")

const { logAndSuppress } = logger

const buildInteractionLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "blackjackGame",
        userId: interaction.user?.id,
        customId: interaction.customId,
        interactionId: interaction.id,
        ...extraMeta
    })

function formatPlayerName(player) {
    const label = player?.tag || player?.username || player?.name || "Player"
    return `**${label}**`
}

async function sendEphemeralError(interaction, content) {
    try {
        await interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        })
    } catch (error) {
        logger.debug("Failed to send ephemeral error", {
            scope: "rebuyManager",
            error: error?.message
        })
    }
}

/**
 * RebuyManager
 *
 * Manages rebuy offers for players who run out of chips during blackjack.
 * Handles rebuy windows, modal interactions, and rebuy processing.
 */
class RebuyManager {
    constructor(game) {
        this.game = game
        this.rebuyOffers = new Map()
    }

    /**
     * Checks if rebuy is enabled for the game.
     *
     * @returns {boolean}
     */
    isRebuyEnabled() {
        return this.game.settings?.allowRebuyMode !== "off"
    }

    /**
     * Gets the rebuy window duration in milliseconds.
     *
     * @returns {number}
     */
    getRebuyWindowMs() {
        const defaults = this.game.constructor.settingDefaults || {}
        const fallback = defaults.rebuyWindowMs || (config?.blackjack?.rebuy?.offerTimeout?.default ?? 60 * 1000)
        const min = defaults.minWindowMs || 30 * 1000
        const max = defaults.maxWindowMs || 10 * 60 * 1000
        const resolved = Number.isFinite(this.game.settings?.rebuyWindowMs)
            ? this.game.settings.rebuyWindowMs
            : fallback

        return Math.max(min, Math.min(max, resolved))
    }

    /**
     * Checks if a player can rebuy.
     *
     * @param {Object} player
     * @returns {boolean}
     */
    canPlayerRebuy(player) {
        if (!player || !this.isRebuyEnabled()) return false

        const mode = this.game.settings?.allowRebuyMode || "on"

        // If mode is "once", check if player already used their rebuy
        if (mode === "once" && Number(player.rebuysUsed) >= 1) {
            return false
        }

        return true
    }

    /**
     * Starts a rebuy offer for a player.
     *
     * @param {Object} player
     * @param {number} windowMs - Rebuy window duration
     * @returns {Promise<Object>} { status: "completed"|"expired"|"failed"|"skipped", playerId: string }
     */
    async startRebuyOffer(player, windowMs) {
        if (!player || !this.game.channel || typeof this.game.channel.send !== "function") {
            return { status: "skipped", playerId: player?.id }
        }

        const customId = `bj_rebuy:${player.id}:${Date.now()}`
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        const playerLabel = formatPlayerName(player)

        const embed = new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle("💸 Rebuy available")
            .setDescription(`${playerLabel} ran out of chips.\nYou have **${seconds}s** to rebuy and stay in the game.`)
            .setFooter({ text: `Window closes in ${seconds}s` })

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel("Rebuy")
                .setStyle(ButtonStyle.Primary)
        )

        let message = null
        try {
            message = await this.game.channel.send({
                embeds: [embed],
                components: [row],
                allowedMentions: { users: [] }
            })
        } catch (error) {
            logger.warn("Failed to send rebuy offer", {
                scope: "rebuyManager",
                playerId: player?.id,
                error: error?.message
            })
            return { status: "failed", playerId: player?.id }
        }

        const filter = withAccessGuard(
            (interaction) => interaction.customId === customId,
            { scope: "blackjack:rebuy" }
        )

        const collector = message.createMessageComponentCollector({
            time: windowMs,
            filter
        })

        const outcome = new Promise((resolve) => {
            collector.on("collect", async (interaction) => {
                // Only the player who ran out can rebuy
                if (interaction.user?.id !== player.id) {
                    await interaction.reply({
                        content: "❌ Only this player can rebuy.",
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        buildInteractionLog(interaction, "Failed to warn non-player on rebuy offer", {
                            phase: "rebuy"
                        })
                    )
                    return
                }

                // Check if table is closing
                if (this.game.__stopping) {
                    await interaction.reply({
                        content: "❌ This table is closing. Rebuy unavailable.",
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        buildInteractionLog(interaction, "Failed to warn about closing table on rebuy", {
                            phase: "rebuy"
                        })
                    )
                    return
                }

                // Show rebuy modal
                const modalId = `bj_rebuy_modal:${interaction.id}`
                const modal = new ModalBuilder()
                    .setCustomId(modalId)
                    .setTitle("Rebuy amount")
                    .addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId("amount")
                                .setLabel("Buy-in amount")
                                .setStyle(TextInputStyle.Short)
                                .setRequired(false)
                                .setPlaceholder(`Min: ${setSeparator(this.game.minBuyIn)}$ | Max: ${setSeparator(this.game.maxBuyIn)}$`)
                        )
                    )

                try {
                    await interaction.showModal(modal)
                } catch (error) {
                    logger.debug("Failed to show rebuy modal", {
                        scope: "rebuyManager",
                        error: error?.message
                    })
                    return
                }

                // Wait for modal submission
                let submission = null
                try {
                    submission = await interaction.awaitModalSubmit({
                        time: config.blackjack.modalTimeout.default,
                        filter: withAccessGuard(
                            (i) => i.customId === modalId && i.user.id === interaction.user.id,
                            { scope: "blackjack:rebuyModal" }
                        )
                    })
                } catch (_) {
                    return
                }

                if (!submission) return

                // Process rebuy
                const result = await this.processRebuy(player, submission, row, message, embed, playerLabel)

                if (result.success) {
                    resolve({ status: "completed", playerId: player.id })
                    try {
                        collector.stop("completed")
                    } catch (_) {
                        /* ignore */
                    }
                }
            })

            collector.on("end", async (_collected, reason) => {
                const disabledRow = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(row.components[0]).setDisabled(true)
                )

                try {
                    if (reason !== "completed") {
                        const expiredEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                            .setDescription(`⏳ Rebuy window expired for ${playerLabel}.`)
                            .setColor(Colors.DarkRed)
                            .setFooter({ text: "Player remains out" })
                        await message.edit({ embeds: [expiredEmbed], components: [disabledRow] }).catch(() => null)
                        this.game.appendDealerTimeline(`${formatPlayerName(player)} did not rebuy in time.`)
                    } else {
                        await message.edit({ components: [disabledRow] }).catch(() => null)
                    }
                } catch (_) {
                    /* ignore */
                }

                if (reason !== "completed") {
                    resolve({ status: "expired", playerId: player?.id })
                }

                this.rebuyOffers.delete(player.id)
            })
        })

        this.rebuyOffers.set(player.id, {
            message,
            collector,
            expiresAt: Date.now() + windowMs
        })

        return outcome
    }

    /**
     * Processes a rebuy for a player after modal submission.
     *
     * @param {Object} player
     * @param {Object} submission - Modal submission interaction
     * @param {Object} row - Button row component
     * @param {Object} message - Rebuy offer message
     * @param {Object} embed - Rebuy offer embed
     * @param {string} playerLabel - Formatted player name
     * @returns {Promise<Object>} { success: boolean, amount?: number }
     */
    async processRebuy(player, submission, row, message, embed, playerLabel) {
        const rawAmount = submission.fields.getTextInputValue("amount")?.trim()
        const parsedAmount = rawAmount ? features.inputConverter(rawAmount) : this.game.minBuyIn

        const buyInResult = bankrollManager.normalizeBuyIn({
            requested: parsedAmount,
            minBuyIn: this.game.minBuyIn,
            maxBuyIn: this.game.maxBuyIn,
            bankroll: bankrollManager.getBankroll(submission.user)
        })

        if (!buyInResult.ok) {
            await sendEphemeralError(submission, "❌ Invalid amount for rebuy.")
            return { success: false, reason: buyInResult.reason }
        }

        // Commit buy-in to database
        try {
            await this.game.commitBuyIn(submission.user, buyInResult.amount)
        } catch (error) {
            await sendEphemeralError(submission, "❌ Rebuy failed. Please try again.")
            return { success: false, reason: "commitFailed" }
        }

        // Update player state
        player.stack = buyInResult.amount
        player.pendingBuyIn = buyInResult.amount
        player.buyInAmount = buyInResult.amount
        player.newEntry = false
        player.rebuysUsed = (Number(player.rebuysUsed) || 0) + 1
        player.status = player.status || {}
        player.status.pendingRebuy = false
        player.status.removed = false
        player.status.leftThisHand = true

        this.game.appendDealerTimeline(`${formatPlayerName(player)} rebuys for ${setSeparator(buyInResult.amount)}$.`)

        // Confirm to player
        await submission.reply({
            content: `✅ Rebuy successful: **${setSeparator(buyInResult.amount)}$**.`,
            flags: MessageFlags.Ephemeral
        }).catch(
            buildInteractionLog(submission, "Failed to confirm rebuy", {
                phase: "rebuy"
            })
        )

        // Update rebuy offer message
        try {
            const disabledRow = new ActionRowBuilder().addComponents(
                ButtonBuilder.from(row.components[0]).setDisabled(true)
            )
            const updatedEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                .setDescription(`✅ ${playerLabel} rejoined with **${setSeparator(buyInResult.amount)}$**.`)
                .setColor(Colors.Green)
                .setFooter({ text: "▶️ Game will resume shortly" })
            await message.edit({
                embeds: [updatedEmbed],
                components: [disabledRow]
            }).catch(() => null)
        } catch (_) {
            // Ignore edit errors
        }

        return { success: true, amount: buyInResult.amount }
    }

    /**
     * Handles players who ran out of funds.
     *
     * @param {Array} playersOutOfMoney
     * @param {Object} options
     * @returns {Promise<Object>} { removed: number, endedGame: boolean, waitingForRebuy: boolean }
     */
    async handlePlayersOutOfFunds(playersOutOfMoney, options = {}) {
        const { finalizeGame = false } = options

        if (!Array.isArray(playersOutOfMoney) || playersOutOfMoney.length === 0) {
            return { removed: 0, endedGame: false, waitingForRebuy: false }
        }

        const rebuyEnabled = this.isRebuyEnabled()
        const rebuyCandidates = []

        // Identify rebuy candidates
        for (const bustedPlayer of playersOutOfMoney) {
            if (rebuyEnabled && this.canPlayerRebuy(bustedPlayer)) {
                bustedPlayer.status = bustedPlayer.status || {}
                bustedPlayer.status.pendingRebuy = true
                rebuyCandidates.push(bustedPlayer)
            }
        }

        // Remove players immediately if: rebuy disabled OR no one can rebuy OR table finalizing
        const shouldRemoveImmediately = !rebuyEnabled || rebuyCandidates.length === 0 || finalizeGame

        if (shouldRemoveImmediately) {
            const removeImmediately = playersOutOfMoney.filter((p) => !p.status?.pendingRebuy)

            for (const player of removeImmediately) {
                await this.game.RemovePlayer(player, {
                    reason: "noMoney",
                    skipStop: true
                })
            }

            const endedGame = finalizeGame && this.game.players.length === 0

            return {
                removed: removeImmediately.length,
                endedGame,
                waitingForRebuy: false
            }
        }

        // Offer rebuys
        const windowMs = this.getRebuyWindowMs()
        this.game.waitingForRebuy = true

        const rebuyPromises = rebuyCandidates.map((player) =>
            this.startRebuyOffer(player, windowMs)
        )

        const rebuyResults = await Promise.all(rebuyPromises)

        this.game.waitingForRebuy = false

        // Remove players who didn't rebuy
        const failedRebuys = rebuyCandidates.filter((player, idx) => {
            const result = rebuyResults[idx]
            return result?.status !== "completed"
        })

        for (const player of failedRebuys) {
            await this.game.RemovePlayer(player, {
                reason: "noMoney",
                skipStop: true
            })
        }

        return {
            removed: failedRebuys.length,
            endedGame: false,
            waitingForRebuy: false
        }
    }
}

module.exports = RebuyManager
