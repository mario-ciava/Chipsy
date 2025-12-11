const {
    EmbedBuilder,
    Colors,
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle
} = require("discord.js")
const setSeparator = require("../../../shared/utils/setSeparator")
const logger = require("../../../shared/logger")

class TexasMessageCoordinator {
    constructor(game) {
        this.game = game
    }

    async SendMessage(type, options = {}) {
        const game = this.game
        if (type !== "handEnded") return
        const channel = game.channel
        const showdownRender = options.showdown !== undefined ? options.showdown : true
        const revealWinnerId = options.revealWinnerId || null
        const revealWinner = revealWinnerId ? game.GetPlayer(revealWinnerId) : null
        const sendEmbed = async (embed, components = []) => {
            try {
                return await channel.send({ embeds: [embed], components })
            } catch (error) {
                logger.error(`Failed to send Texas message (type: ${type})`, { error })
                return null
            }
        }

        const eligiblePlayers = (game.players || []).filter((p) => {
            if (!p) return false
            const status = p.status || {}
            if (status.pendingRemoval || status.pendingRebuy) return false
            if (status.removed && !status.pendingRejoin) return false
            return true
        })
        const footerText = !game.waitingForRebuy && eligiblePlayers.length <= 1
            ? "🏆 Game over: Only 1 player remaining!"
            : "Showdown complete"
        const embed = new EmbedBuilder()
            .setColor(Colors.Gold)
            .setTitle(`Hand #${game.hands} Ended`)
            .setFooter({ text: footerText })

        embed.addFields(...game.buildInfoAndTimelineFields({ toCall: 0 }))

        game.inGamePlayers.forEach(p => {
            p.bets.current = 0
        })

        const snapshot = await game.captureTableRender({
            title: showdownRender ? "Showdown" : "Hand Complete",
            showdown: showdownRender,
            focusPlayerId: revealWinnerId,
            revealFocusCards: showdownRender && Boolean(revealWinnerId)
        })
        if (!snapshot) {
            logger.warn("Texas table snapshot missing for showdown", {
                scope: "texasGame",
                hand: game.hands,
                showdownRender,
                revealWinnerId
            })
        }

        const messagePayload = {
            embeds: [embed],
            files: snapshot ? [snapshot.attachment] : [],
            components: []
        }
        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
        }

        const revealRow = []
        if (revealWinner && !showdownRender && revealWinner.user && !revealWinner.user.bot) {
            revealRow.push(
                new ButtonBuilder()
                    .setCustomId(`tx_reveal:${game.hands}:${revealWinner.id}`)
                    .setLabel("Reveal winning hand")
                    .setStyle(ButtonStyle.Primary)
            )
        }
        const leaveRow = new ButtonBuilder()
            .setCustomId(`tx_action:leave:${revealWinnerId || "any"}`)
            .setLabel("Leave")
            .setStyle(ButtonStyle.Secondary)

        const combinedRow = new ActionRowBuilder()
        if (revealRow.length) revealRow.forEach(btn => combinedRow.addComponents(btn))
        combinedRow.addComponents(leaveRow.setStyle(ButtonStyle.Danger))
        messagePayload.components.push(combinedRow)

        const message = await game.broadcaster.broadcast(messagePayload)
        
        if (messagePayload.components.length === 0) return

        const revealRequests = new Map()
        
        game.broadcaster.createCollectors({
            time: 10_000,
            filter: (i) => i.customId === `tx_reveal:${game.hands}:${revealWinnerId}` || i.customId === `tx_action:leave:${revealWinnerId || "any"}`
        }, async (interaction) => {
            if (interaction.customId.startsWith("tx_action:leave")) {
                const player = game.GetPlayer(interaction.user.id)
                if (player) {
                    await interaction.deferUpdate().catch(() => null)
                    await game.RemovePlayer(player, { skipStop: false })
                    await game.respondEphemeral(interaction, { content: "✅ You left the table." })
                } else {
                    await game.respondEphemeral(interaction, { content: "⚠️ You are not seated at this table." })
                }
                return
            }
            revealRequests.set(interaction.user.id, interaction)
            await interaction.deferUpdate().catch(() => null)
        }, async () => {
            const components = messagePayload.components.map((row) => {
                const updatedRow = ActionRowBuilder.from(row)
                updatedRow.components = row.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
                return updatedRow
            })

            let updatedEmbed = EmbedBuilder.from(embed)
            let updatedFiles = messagePayload.files

            if (revealRequests.size > 0) {
                const revealPlayerIds = Array.from(revealRequests.keys())
                let revealedSnapshot = null
                try {
                    revealedSnapshot = await game.captureTableRender({
                        title: "Showdown",
                        showdown: false,
                        focusPlayerId: revealWinnerId,
                        revealFocusCards: false,
                        revealPlayerIds
                    })
                } catch (error) {
                    logger.warn("Failed to capture reveal snapshot", {
                        scope: "texasGame",
                        hand: game.hands,
                        error: error?.message
                    })
                }

                if (revealedSnapshot) {
                    updatedEmbed.setImage(`attachment://${revealedSnapshot.filename}`)
                    updatedFiles = [revealedSnapshot.attachment]
                } else {
                    updatedEmbed.setImage(null)
                }
            }

            await game.broadcaster.broadcast({
                embeds: [updatedEmbed],
                files: updatedFiles,
                components
            }).catch(() => null)
        })

        game.lastHandMessage = message
    }

    async updateGameMessage(player, options = {}) {
        const game = this.game
        const availableOptions = Array.isArray(options.availableOptions)
            ? options.availableOptions
            : await game.GetAvailableOptions(player)
        const paused = Boolean(options.remotePaused || (game.isRemotePauseActive && game.isRemotePauseActive()))
        const components = []
        if (!options.hideActions && !paused) {
            const row = new ActionRowBuilder()
            if (availableOptions.includes("fold")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:fold:${player.id}`).setLabel("Fold").setStyle(ButtonStyle.Danger))
            }
            if (availableOptions.includes("check")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:check:${player.id}`).setLabel("Check").setStyle(ButtonStyle.Secondary))
            }
            if (availableOptions.includes("call")) {
                const callAmount = Math.max(0, game.bets.currentMax - player.bets.current)
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:call:${player.id}`).setLabel(`Call (${setSeparator(callAmount)})`).setStyle(ButtonStyle.Success))
            }
            if (availableOptions.includes("bet")) {
                const minBet = game.getTableMinBet()
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:bet_fixed:${player.id}:${minBet}`).setLabel(`Bet (${setSeparator(minBet)})`).setStyle(ButtonStyle.Primary))
            }
            if (availableOptions.includes("raise")) {
                const minRaiseTotal = game.bets.currentMax + game.bets.minRaise
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:raise_fixed:${player.id}:${minRaiseTotal}`).setLabel(`Raise (${setSeparator(minRaiseTotal)})`).setStyle(ButtonStyle.Primary))
            }
            if (availableOptions.includes("allin")) {
                const toCall = Math.max(0, game.bets.currentMax - player.bets.current)
                const callIsAllIn = availableOptions.includes("call") && toCall >= player.stack
                if (!callIsAllIn) {
                    row.addComponents(new ButtonBuilder().setCustomId(`tx_action:allin:${player.id}`).setLabel(`All-in (${setSeparator(player.stack)})`).setStyle(ButtonStyle.Danger))
                }
            }
            if (availableOptions.includes("leave")) {
                row.addComponents(new ButtonBuilder().setCustomId(`tx_action:leave:${player.id}`).setLabel("Leave").setStyle(ButtonStyle.Danger))
            }
            if (row.components.length > 0) components.push(row)

            if (availableOptions.includes("bet") || availableOptions.includes("raise")) {
                const customRow = new ActionRowBuilder()
                customRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`tx_action:custom:${player.id}`)
                        .setLabel("Custom amount")
                        .setStyle(ButtonStyle.Secondary)
                )
                components.push(customRow)
            }
        }

        let snapshot = null
        if (game.inGamePlayers.length >= 2) {
            snapshot = await game.captureTableRender({ title: `${player.tag}'s turn`, focusPlayerId: player.id })
            if (snapshot) {
                game.lastValidSnapshot = snapshot
            }
            if (!snapshot) {
                logger.warn("Texas action snapshot missing", {
                    scope: "texasGame",
                    hand: game.hands,
                    playerId: player?.id
                })
            }
        } else if (game.lastValidSnapshot) {
            snapshot = game.lastValidSnapshot
        }
        const currentBet = player.bets?.current || 0
        const toCall = Math.max(0, game.bets.currentMax - currentBet)
        const embed = new EmbedBuilder()
            .setColor(Colors.Blue)
            .setTitle(`Texas Hold'em - Round #${game.hands}`)

        const footerParts = [
            `Round #${game.hands}`,
            `${Math.round(game.actionTimeoutMs / 1000)}s per turn`
        ]
        if (paused) {
            footerParts.push("Remote pause active")
        }
        if (game.inactiveHands >= 1 && !game.currentHandHasInteraction) {
            footerParts.push("⚠️ No recent actions: table may close soon")
        }
        embed.setFooter({ text: footerParts.join(" | ") })
        if (paused) {
            embed.setColor(Colors.DarkGrey)
        }

        embed.addFields(...game.buildInfoAndTimelineFields({ toCall }))

        if (paused) {
            embed.setDescription("⏸️ Table paused by admins. Please wait.")
        }

        const payload = { embeds: [embed], components, files: [], attachments: [] }

        if (snapshot) {
            embed.setImage(`attachment://${snapshot.filename}`)
            payload.files.push(snapshot.attachment)
        }

        const fresh = Boolean(game.roundMessageFresh)
        await game.broadcaster.broadcast(payload, {
            fresh,
            cleanupOld: Boolean(game.settings?.autoCleanHands)
        })
        if (fresh) {
            game.roundMessageFresh = false
        }

        if (!game.holeCardsSent) {
            if (game.pendingProbabilityTask) {
                try {
                    await game.pendingProbabilityTask
                } catch {
                }
            }
            await game.remindAllPlayersHoleCards()
            game.holeCardsSent = true
        }
    }
}

module.exports = TexasMessageCoordinator
