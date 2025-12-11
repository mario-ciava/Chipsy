const {
    EmbedBuilder,
    Colors,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require("discord.js")
const setSeparator = require("../../../shared/utils/setSeparator")
const logger = require("../../../shared/logger")
const { withAccessGuard } = require("../../utils/interactionAccess")
const bankrollManager = require("../../utils/bankrollManager")
const features = require("../../../shared/features")
const config = require("../../../config")
const { defaults: texasSettingDefaults } = require("./settings")

class TexasRebuyManager {
    constructor(game) {
        this.game = game
    }

    get offers() {
        return this.game.rebuyOffers
    }

    isRebuyEnabled() {
        return this.game.settings?.allowRebuyMode !== "off"
    }

    getRebuyWindowMs() {
        const fallback = texasSettingDefaults.rebuyWindowMs || 60 * 1000
        const min = texasSettingDefaults.minWindowMs || 30 * 1000
        const max = texasSettingDefaults.maxWindowMs || 10 * 60 * 1000
        const resolved = Number.isFinite(this.game.settings?.rebuyWindowMs)
            ? this.game.settings.rebuyWindowMs
            : fallback
        return Math.max(min, Math.min(max, resolved))
    }

    canPlayerRebuy(player) {
        if (!player || !this.isRebuyEnabled()) return false
        const mode = this.game.settings?.allowRebuyMode || "on"
        if (mode === "off") return false
        if (mode === "once" && Number(player.rebuysUsed) >= 1) return false
        return true
    }

    buildRebuyPauseFooter(windowMs) {
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        return `⏸️ Waiting for rebuy: the table will remain paused for up to ${seconds}s.`
    }

    async applyRebuyPauseFooter(windowMs) {
        const footerText = this.buildRebuyPauseFooter(windowMs)
        for (const [playerId, offer] of this.offers.entries()) {
            const message = offer?.message
            if (!message || !Array.isArray(message.embeds) || message.embeds.length === 0) continue
            try {
                const updatedEmbed = EmbedBuilder.from(message.embeds[0]).setFooter({ text: footerText })
                await message.edit({
                    embeds: [updatedEmbed],
                    components: message.components || []
                })
            } catch (error) {
                logger.debug("Failed to update rebuy pause footer", {
                    scope: "texasGame",
                    playerId,
                    error: error?.message
                })
            }
        }
    }

    async handleBustedPlayer(player) {
        if (!player) return
        if (!this.canPlayerRebuy(player)) {
            await this.game.RemovePlayer(player, { skipStop: true, reason: "busted" })
            return
        }

        const windowMs = this.getRebuyWindowMs()
        player.status = player.status || {}
        player.status.pendingRebuy = true
        player.status.rebuyDeadline = Date.now() + windowMs
        player.status.removed = true
        player.status.leftThisHand = true
        player.status.pendingRemoval = false
        player.status.folded = true
        player.status.allIn = false
        player.status.lastAction = { type: "busted", ts: Date.now() }
        player.bets = { current: 0, total: 0 }
        player.stack = Math.max(0, player.stack || 0)

        this.game.UpdateInGame()

        await this.startRebuyOffer(player, windowMs)
    }

    async waitForPendingRebuys() {
        this.game.waitingForRebuy = true
        const windowMs = this.getRebuyWindowMs()
        try {
            await this.applyRebuyPauseFooter(windowMs)
        } catch (error) {
            logger.debug("Failed to apply rebuy wait footer", {
                scope: "texasGame",
                error: error?.message
            })
        }
    }

    async startRebuyOffer(player, windowMs) {
        const game = this.game
        if (!game.channel || typeof game.channel.send !== "function") return

        const existing = this.offers.get(player.id)
        if (existing?.collector && !existing.collector.ended) {
            try {
                existing.collector.stop("replaced")
            } catch (_) { /* ignore */ }
        }

        const customId = `tx_rebuy:${player.id}:${Date.now()}`
        const playerLabel = player.tag || player.username || player
        const seconds = Math.max(1, Math.round(windowMs / 1000))
        const embed = new EmbedBuilder()
            .setColor(Colors.Orange)
            .setTitle("💸 Rebuy available")
            .setDescription(`${playerLabel} ran out of chips.\nYou have **${seconds}s** to rebuy and stay in the game.`)

        if (game.waitingForRebuy) {
            embed.setFooter({ text: this.buildRebuyPauseFooter(windowMs) })
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel("Rebuy")
                .setStyle(ButtonStyle.Primary)
        )

        let message = null
        try {
            message = await game.channel.send({
                embeds: [embed],
                components: [row],
                allowedMentions: { parse: [] }
            })
        } catch (error) {
            logger.warn("Failed to send rebuy offer", {
                scope: "texasGame",
                playerId: player?.id,
                error: error?.message
            })
            return
        }

        const filter = withAccessGuard(
            (interaction) => interaction.customId === customId,
            { scope: "texas:rebuy" }
        )

        const collector = message.createMessageComponentCollector({
            time: windowMs,
            filter
        })

        collector.on("collect", async (interaction) => {
            if (interaction.user?.id !== player.id) {
                await game.respondEphemeral(interaction, { content: "❌ Only this player can rebuy." })
                return
            }

            const modalId = `tx_rebuy_modal:${interaction.id}`
            const modal = new ModalBuilder()
                .setCustomId(modalId)
                .setTitle("Rebuy amount")
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId("amount")
                            .setLabel("Buy-in amount")
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setValue(String(game.minBuyIn))
                    )
                )

            try {
                await interaction.showModal(modal)
            } catch (error) {
                logger.warn("Failed to show rebuy modal", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
                return
            }

            let submission = null
            try {
                submission = await interaction.awaitModalSubmit({
                    time: config.texas.modalTimeout.default,
                    filter: withAccessGuard(
                        (i) => i.customId === modalId && i.user.id === interaction.user.id,
                        { scope: "texas:rebuyModal" }
                    )
                })
            } catch (_) {
                return
            }

            if (!submission) return

            const parsed = features.inputConverter(submission.fields.getTextInputValue("amount"))
            const buyInResult = bankrollManager.normalizeBuyIn({
                requested: parsed,
                minBuyIn: game.minBuyIn,
                maxBuyIn: game.maxBuyIn,
                bankroll: bankrollManager.getBankroll(submission.user)
            })

            if (!buyInResult.ok) {
                await game.respondEphemeral(submission, {
                    content: `❌ ${buyInResult.reason === "insufficientBankroll" ? "Not enough bankroll for this rebuy." : "Invalid amount."}`
                })
                return
            }

            try {
                submission.user.data.money = bankrollManager.getBankroll(submission.user) - buyInResult.amount
                player.stack = buyInResult.amount
                const resumeNow = Boolean(game.waitingForRebuy)
                player.status.pendingRebuy = false
                player.status.pendingRemoval = false
                player.status.pendingRejoin = resumeNow ? false : true
                player.status.removed = resumeNow ? false : true
                player.status.leftThisHand = true
                player.status.folded = true
                player.status.allIn = false
                player.status.movedone = true
                player.bets = { current: 0, total: 0 }
                player.status.lastAction = { type: "rebuy", amount: buyInResult.amount, ts: Date.now() }
                player.rebuysUsed = (Number(player.rebuysUsed) || 0) + 1

                await game.dataHandler.updateUserData(submission.user.id, game.dataHandler.resolveDBUser(submission.user))

                await game.respondEphemeral(submission, {
                    content: `✅ Rebuy successful: **${setSeparator(buyInResult.amount)}$**.`
                })

                if (message) {
                    const disabledRow = new ActionRowBuilder().addComponents(
                        ButtonBuilder.from(row.components[0]).setDisabled(true)
                    )
                    const resumedEmbed = EmbedBuilder.from(message.embeds?.[0] || embed)
                        .setDescription(`✅ ${playerLabel} rejoined with **${setSeparator(buyInResult.amount)}$**.`)
                        .setFooter({ text: "▶️ Game resumed" })
                        .setColor(Colors.Green)
                    await message.edit({
                        embeds: [resumedEmbed],
                        components: [disabledRow]
                    }).catch(() => null)
                }

                try {
                    collector.stop("completed")
                } catch (_) { /* ignore */ }

                await this.onRebuyCompleted(player)
            } catch (error) {
                logger.warn("Failed to process rebuy", {
                    scope: "texasGame",
                    playerId: player?.id,
                    error: error?.message
                })
                await game.respondEphemeral(submission, {
                    content: "❌ Rebuy failed. Please try again."
                })
            }
        })

        collector.on("end", async (_collected, reason) => {
            try {
                const disabled = new ActionRowBuilder().addComponents(
                    ButtonBuilder.from(row.components[0]).setDisabled(true)
                )
                await message.edit({ components: [disabled] }).catch(() => null)
            } catch (_) { /* ignore */ }

            this.offers.delete(player.id)
            if (reason !== "completed" && reason !== "replaced") {
                await this.onRebuyExpired(player)
            }
        })

        this.offers.set(player.id, { message, collector, expiresAt: Date.now() + windowMs })
    }

    async onRebuyExpired(player) {
        if (!player?.status?.pendingRebuy) return
        player.status.pendingRebuy = false
        player.status.removed = true
        player.status.leftThisHand = true
        player.status.pendingRemoval = false
        player.status.rebuyDeadline = null

        this.game.UpdateInGame()
        await this.evaluateRebuyState()
    }

    async onRebuyCompleted(player) {
        this.game.UpdateInGame()
        await this.evaluateRebuyState()
    }

    async evaluateRebuyState() {
        const activePlayers = this.game.players.filter((p) =>
            (!p.status?.removed || p.status?.pendingRejoin) &&
            !p.status?.pendingRemoval &&
            !p.status?.pendingRebuy
        )
        const pendingRebuys = this.game.players.filter((p) => p.status?.pendingRebuy)

        if (activePlayers.length >= this.game.getMinimumPlayers()) {
            if (this.game.waitingForRebuy) {
                this.game.waitingForRebuy = false
                if (!this.game.awaitingPlayerId && !this.game.timer) {
                    try {
                        await this.game.StartGame()
                    } catch (error) {
                        logger.warn("Failed to restart game after rebuy", {
                            scope: "texasGame",
                            error: error?.message
                        })
                    }
                }
            }
            return
        }

        if (pendingRebuys.length > 0) {
            this.game.waitingForRebuy = true
            try {
                await this.applyRebuyPauseFooter(this.getRebuyWindowMs())
            } catch (error) {
                logger.debug("Failed to refresh rebuy footer while waiting", {
                    scope: "texasGame",
                    error: error?.message
                })
            }
            return
        }

        try {
            await this.game.Stop({ reason: "notEnoughPlayers" })
        } catch (error) {
            logger.warn("Failed to stop after rebuy expiration", {
                scope: "texasGame",
                error: error?.message
            })
        }
    }
}

module.exports = TexasRebuyManager
