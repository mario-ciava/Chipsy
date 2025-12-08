const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } = require("discord.js")
const TexasGame = require("../games/texas/texasGame.js")
const features = require("../../shared/features")
const setSeparator = require("../utils/setSeparator")
const logger = require("../utils/logger")
const { logAndSuppress } = logger
const createCommand = require("../utils/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const bankrollManager = require("../utils/bankrollManager")
const { registerGame } = require("../utils/gameRegistry")
const { createLobbySession } = require("../lobbies")
const { resolveTexasSettings, defaults: texasSettingDefaults } = require("../games/texas/settings")
const config = require("../../config")

const EPHEMERAL_CLEANUP_MS = 8000

const buildTexasCommandLog = (interaction, message, extraMeta = {}) =>
    logAndSuppress(message, {
        scope: "commands.texas",
        interactionId: interaction?.id,
        channelId: interaction?.channel?.id || interaction?.channelId,
        userId: interaction?.user?.id,
        ...extraMeta
    })

const buildTexasStopLogger = (channelId, reason) => (error) => {
    logger.warn("Failed to stop Texas game", {
        scope: "commands.texas",
        channelId,
        reason,
        error: error?.message
    })
    return null
}

const runTexas = async(interaction, client) => {
    const channel = interaction.channel

    const replyOrEdit = (payload = {}) => {
        const finalPayload = { ...payload, allowedMentions: { parse: [] } }
        return sendInteractionResponse(interaction, finalPayload)
    }

    const scheduleEphemeralCleanup = (message) => {
        if (message && typeof message.delete === "function") {
            setTimeout(() => {
                message.delete().catch(() => null)
            }, EPHEMERAL_CLEANUP_MS)
        }
    }

    const logLobbyInteraction = (component, message, extra = {}) =>
        buildTexasCommandLog(component, message, { phase: "lobby", ...extra })

    if (channel.__texasStarting) {
        await replyOrEdit({
            embeds: [new EmbedBuilder()
                .setColor(Colors.Orange)
                .setFooter({
                    text: `${interaction.user.tag}, please wait: a Texas Hold'em table is already being initialized.`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    if (channel.game) {
        await replyOrEdit({
            embeds: [new EmbedBuilder()
                .setColor(Colors.Red)
                .setFooter({
                    text: `${interaction.user.tag}, access denied: a game is already in progress in this channel.`,
                    iconURL: interaction.user.displayAvatarURL({ extension: "png" })
                })
            ]
        })
        return
    }

    channel.__texasStarting = true

    let game = null
    let lobbySettings = { ...texasSettingDefaults, allowRebuyMode: "on", autoCleanHands: false }

    try {
        const minBetRaw = interaction.options.getString("minbet", true)
        const maxPlayersInput = interaction.options.getInteger("maxplayers")

        const minBet = features.inputConverter(minBetRaw)

        if (!Number.isFinite(minBet) || minBet <= 0) {
            await replyOrEdit({
                content: `❌ ${interaction.user.tag}, the minimum bet must be a positive number.`,
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const normalizedMaxPlayers = Number.isInteger(maxPlayersInput)
            ? Math.min(Math.max(maxPlayersInput, 2), 9)
            : 9

        const safeMinBet = Math.max(1, Math.floor(minBet))
        const maxBuyIn = Math.min(safeMinBet * 100, Number.MAX_SAFE_INTEGER)

        logger.debug("Creating Texas Hold'em game", {
            scope: "commands",
            command: "texas",
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            channelId: channel.id
        })

        const messageAdapter = {
            author: interaction.user,
            channel: interaction.channel,
            client
        }

        const effectiveSettings = resolveTexasSettings({ overrides: lobbySettings })

        game = new TexasGame({
            message: messageAdapter,
            minBet: safeMinBet,
            maxPlayers: normalizedMaxPlayers,
            maxBuyIn,
            settings: effectiveSettings
        });
        registerGame(client, game)
        channel.game = game

        const hostId = interaction.user.id
        const hostMention = `<@${hostId}>`
        if (typeof game.setRemoteMeta === "function") {
            const hostAvatar = typeof interaction.user.displayAvatarURL === "function"
                ? interaction.user.displayAvatarURL({ extension: "png", size: 64 })
                : null
            game.setRemoteMeta({
                label: "Texas Hold'em",
                type: "texas",
                origin: "command:texas",
                host: {
                    id: hostId,
                    tag: interaction.user.tag,
                    username: interaction.user.username,
                    avatar: hostAvatar
                },
                channelId: channel.id,
                channelName: channel.name,
                guildId: channel.guild?.id,
                guildName: channel.guild?.name,
                turnTimeoutMs: game.actionTimeoutMs || null
            })
        }

        const resolveLobbyStack = (player) => {
            if (!player) return 0
            const entryStack = Number.isFinite(player.entryStack) ? player.entryStack : null
            if (entryStack !== null && entryStack >= 0) return entryStack
            const stack = Number.isFinite(player.stack) ? player.stack : 0
            return stack
        }

        const formatPlayers = () => {
            const players = game?.players || []
            if (!players.length) return "—"
            return players
                .map(p => {
                    const displayStack = resolveLobbyStack(p)
                    return `<@${p.id}> - ${setSeparator(displayStack)}$`
                })
                .join("\n")
        }

        const statusConfig = {
            waiting: { color: Colors.Green, footer: "Waiting for players..." },
            starting: { color: Colors.Blurple, footer: "Starting the game..." },
            canceled: { color: Colors.Red, footer: "Game canceled." },
            ended: { color: Colors.DarkGrey, footer: "Game ended." }
        }

        const renderLobbyView = ({ state }) => {
            const players = game?.players || []
            const maxPlayersLimit = game?.maxPlayers || 9
            const status = state?.status || "waiting"
            const palette = statusConfig[status] || statusConfig.waiting
            const lobbyClosed = Boolean(state?.closed || status === "ended" || status === "canceled")
            const playerCountLabel = `${players.length}/${maxPlayersLimit}`
            const tableIsFull = players.length >= maxPlayersLimit
            const hasPlayers = players.length > 1
            const actionTimeoutSeconds = Math.round((game?.actionTimeoutMs || config.texas.actionTimeout.default) / 1000)
            const settings = resolveTexasSettings({ overrides: state?.settings || lobbySettings })
            const allowRebuyLabel = (() => {
                if (settings.allowRebuyMode === "off") return "Disabled"
                if (settings.allowRebuyMode === "once") return "Allow once"
                return `Enabled (${Math.round(settings.rebuyWindowMs / 1000)}s)`
            })()
            const autoCleanLabel = settings.autoCleanHands ? "On" : "Off"

            const embed = new EmbedBuilder()
                .setColor(palette.color)
                .setTitle("♠️ Texas Hold'em — Lobby")
                .setDescription("Press **Join** to buy in. The host can start when at least 2 players have joined.")
                .addFields(
                    { name: `👥 Players [${playerCountLabel}]`, value: formatPlayers(), inline: true },
                    { name: "👑 Host", value: hostMention, inline: true },
                    { name: "💰 Requirements", value: `Min buy-in: ${setSeparator(game.minBuyIn)}$
Max buy-in: ${setSeparator(game.maxBuyIn)}$
Small/Big Blind: ${setSeparator(game.minBet / 2)}$/${setSeparator(game.minBet)}$`, inline: false },
                    { name: "⏱️ Table speed", value: `${actionTimeoutSeconds}s per action`, inline: true },
                    { name: "♻️ Rebuy", value: allowRebuyLabel, inline: true },
                    { name: "🧹 Auto clean hands", value: autoCleanLabel, inline: true }
                )
                .setFooter({ text: state?.footerText || palette.footer })
                .setTimestamp()

            const components = []
            if (!lobbyClosed) {
                components.push(
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId("tx:join").setLabel("Join").setStyle(ButtonStyle.Success).setDisabled(tableIsFull),
                        new ButtonBuilder().setCustomId("tx:leave").setLabel("Leave").setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId("tx:start").setLabel("Start").setStyle(ButtonStyle.Primary).setDisabled(!hasPlayers),
                        new ButtonBuilder().setCustomId("tx:cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("tx:settings").setLabel("Settings").setStyle(ButtonStyle.Secondary)
                    )
                )

                if (state?.showSettings) {
                    const rebuySelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:rebuyToggle")
                        .setPlaceholder("Rebuy")
                        .addOptions(
                            { label: "Allow rebuy", value: "on", default: settings.allowRebuyMode === "on", emoji: "✅" },
                            { label: "Allow once", value: "once", default: settings.allowRebuyMode === "once", emoji: "1️⃣" },
                            { label: "Disallow rebuy", value: "off", default: settings.allowRebuyMode === "off", emoji: "⛔" }
                        )

                    const currentActionSeconds = Math.round((game?.actionTimeoutMs || 0) / 1000)
                    const actionTimeoutSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:actionTimeout")
                        .setPlaceholder(`⏱️ Table speed — ${currentActionSeconds}s per action`)
                        .addOptions(
                            ["15","30","45","60","75","90","120","180","240"].map((label) => {
                                const numeric = Number(label)
                                return {
                                    label: `⏱️ Table speed — ${label}s`,
                                    value: label,
                                    default: currentActionSeconds === numeric
                                }
                            })
                        )

                    const rebuyWindowSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:rebuyWindow")
                        .setPlaceholder(`♻️ Rebuy window — ${Math.round(settings.rebuyWindowMs / 1000)}s`)
                        .addOptions(
                            ["30","60","90"].map((label) => ({
                                label: `♻️ Rebuy window — ${label}s`,
                                value: label,
                                default: Math.round(settings.rebuyWindowMs / 1000) === Number(label)
                            }))
                        )

                    const cleanSelect = new StringSelectMenuBuilder()
                        .setCustomId("tx:settings:autoCleanHands")
                        .setPlaceholder(`🧹 Auto clean hands — ${settings.autoCleanHands ? "On" : "Off"}`)
                        .addOptions(
                            { label: "Auto clean - On", value: "on", default: settings.autoCleanHands === true, emoji: "✅" },
                            { label: "Auto clean - Off", value: "off", default: !settings.autoCleanHands, emoji: "⛔" }
                        )

                    components.push(new ActionRowBuilder().addComponents(rebuySelect))
                    components.push(new ActionRowBuilder().addComponents(actionTimeoutSelect))
                    components.push(new ActionRowBuilder().addComponents(rebuyWindowSelect))
                    components.push(new ActionRowBuilder().addComponents(cleanSelect))
                }
            }

            return { embeds: [embed], components }
        }

        const ensureUserData = async(user) => {
            if (!user?.data) {
                const result = await client.SetData(user)
                if (result.error) {
                    if (result.error.type === "database") {
                        await channel.send({
                            content: `❌ ${user.tag}, database connection error. Please try again later.`,
                            allowedMentions: { parse: [] },
                            flags: MessageFlags.SuppressNotifications
                        }).catch(
                            logAndSuppress("Failed to send Texas database error notice", {
                                scope: "commands.texas",
                                channelId: channel.id,
                                userId: user?.id
                            })
                        )
                    }
                    throw new Error("user-data-unavailable")
                }
                if (!result.data) {
                    throw new Error("user-data-missing")
                }
            }
        }

        const lobbySession = createLobbySession({
            send: replyOrEdit,
            logger,
            collectorOptions: { time: 5 * 60 * 1000 },
            render: renderLobbyView
        })
        game.lobbySession = lobbySession

        lobbySession.updateState({ status: "waiting", settings: lobbySettings, showSettings: false })
        await lobbySession.open()
        channel.collector = lobbySession.collector

        const startGame = async ({ initiatedBy } = {}) => {
            if (lobbySession.isClosed) return

            // Safety check: remove duplicate players before starting
            const seenIds = new Set()
            const uniquePlayers = []
            for (const player of game.players) {
                if (!seenIds.has(player.id)) {
                    seenIds.add(player.id)
                    uniquePlayers.push(player)
                } else {
                    logger.warn("Removed duplicate player before game start", {
                        scope: "texas.lobby",
                        playerId: player.id,
                        playerTag: player.tag
                    })
                }
            }
            game.players = uniquePlayers

            const footer = initiatedBy ? `Game starting — triggered by ${initiatedBy}` : "Starting..."
            lobbySession.updateState({ status: "starting", footerText: footer })
            await lobbySession.close({ reason: "started" })
            try {
                const effectiveSettings = resolveTexasSettings({ overrides: lobbySession.state?.settings || lobbySettings })
                if (game && typeof game.applySettings === "function") {
                    game.applySettings(effectiveSettings)
                }
                await game.Run()
            } catch (error) {
                logger.error("Failed to start Texas Hold'em game", { scope: "commands", command: "texas", error })
                await game.Stop({ reason: "error" }).catch((stopError) => {
                    logger.warn("Failed to stop Texas game after run error", {
                        scope: "commands.texas",
                        channelId: channel.id,
                        error: stopError?.message
                    })
                })
            }
        }

        lobbySession.bindGame(game, {
            onStop: async ({ reason }) => {
                const status = reason === "canceled" ? "canceled" : "ended"
                lobbySession.updateState({ status, footerText: statusConfig[status].footer })
                await lobbySession.refresh({ force: true, components: [] })
            }
        })

        lobbySession.registerComponentHandler("tx:join", async (i) => {
            // Wrap entire handler to suppress errors from abandoned modals
            // When user opens multiple modals and confirms only one, the other handlers
            // will throw when they timeout - we should suppress those silently
            try {
                if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", flags: MessageFlags.Ephemeral })

                try {
                    await ensureUserData(i.user)
                } catch (error) {
                    if (error.message === "user-data-unavailable") return
                    const responder = i.deferred || i.replied
                        ? i.followUp.bind(i)
                        : i.reply.bind(i)
                    await responder({
                        content: "❌ We could not load your profile right now. Please try again later.",
                        flags: MessageFlags.Ephemeral
                    }).catch(
                        logLobbyInteraction(i, "Failed to respond after user data error")
                    )
                    return
                }
                if (game.players.length >= game.maxPlayers) return i.reply({ content: "⚠️ This table is full.", flags: MessageFlags.Ephemeral })
                if (game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are already at this table.", flags: MessageFlags.Ephemeral })

                const modal = new ModalBuilder().setCustomId(`tx:modal:${i.id}`).setTitle("Join Table").addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId("buyin").setLabel("Buy-in Amount").setStyle(TextInputStyle.Short).setRequired(true).setValue(String(game.minBuyIn))
                    )
                )

                const submission = await lobbySession.presentModal(i, modal)
                if (!submission) return

                // Re-check after modal to prevent race condition (user may have joined via another modal)
                if (game.GetPlayer(submission.user.id)) {
                    return submission.reply({ content: "⚠️ You are already at this table.", flags: MessageFlags.Ephemeral })
                }

                const rawBuyIn = submission.fields.getTextInputValue("buyin")
                const parsedBuyIn = features.inputConverter(rawBuyIn)
                const buyInResult = bankrollManager.normalizeBuyIn({ requested: parsedBuyIn, minBuyIn: game.minBuyIn, maxBuyIn: game.maxBuyIn, bankroll: bankrollManager.getBankroll(submission.user) })

                if (!buyInResult.ok) {
                    return submission.reply({ content: `❌ ${buyInResult.reason}`, flags: MessageFlags.Ephemeral })
                }

                const added = await game.AddPlayer(submission.user, { buyIn: buyInResult.amount })
                if (!added) {
                    await submission.reply({ content: "❌ Unable to join this table. Please try again.", flags: MessageFlags.Ephemeral })
                    return
                }
                game.rememberPlayerInteraction(submission.user.id, submission)
                const joinMessage = await submission.reply({
                    content: `✅ You joined with **${setSeparator(buyInResult.amount)}$**.`,
                    flags: MessageFlags.Ephemeral
                })
                scheduleEphemeralCleanup(joinMessage)
                lobbySession.scheduleRefresh()
            } catch (error) {
                // Suppress errors from abandoned modals - if user already joined via another modal,
                // or the lobby is closed, just silently exit
                if (game.GetPlayer(i.user.id) || lobbySession.isClosed) {
                    return
                }
                // Re-throw other errors so they get logged properly
                throw error
            }
        })

        lobbySession.registerComponentHandler("tx:leave", async (i) => {
            if (lobbySession.isClosed) return i.reply({ content: "❌ This table is no longer available.", flags: MessageFlags.Ephemeral })
            if (!game.GetPlayer(i.user.id)) return i.reply({ content: "⚠️ You are not at this table.", flags: MessageFlags.Ephemeral })
            
            const removed = await game.RemovePlayer(i.user)
            if (removed) {
                await i.reply({ content: "✅ You have left the table.", flags: MessageFlags.Ephemeral })
                lobbySession.scheduleRefresh()
            } else {
                await i.reply({ content: "❌ Failed to leave the table. Please try again.", flags: MessageFlags.Ephemeral })
            }
        })

        lobbySession.registerComponentHandler("tx:start", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can start the game.", flags: MessageFlags.Ephemeral })
            if (game.players.length < game.getMinimumPlayers()) return i.reply({ content: `⚠️ You need at least ${game.getMinimumPlayers()} players to start.`, flags: MessageFlags.Ephemeral })
            
            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            startGame({ initiatedBy: i.user.tag })
        })

        lobbySession.registerComponentHandler("tx:settings", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change settings.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const showSettings = Boolean(lobbySession.state?.showSettings)
            lobbySession.updateState({ showSettings: !showSettings })
            await i.deferUpdate().catch(() => null)
            lobbySession.scheduleRefresh()
        })

        // Handle rebuy toggle via select menu
        lobbySession.registerPrefixedHandler("tx:settings:rebuyToggle", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change settings.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const currentRebuyWindowMs = lobbySession.state?.settings?.rebuyWindowMs ?? lobbySettings.rebuyWindowMs ?? 60000
            const updatedSettings = {
                allowRebuyMode: value === "off" ? "off" : value === "once" ? "once" : "on",
                rebuyWindowMs: currentRebuyWindowMs,
                autoCleanHands: lobbySession.state?.settings?.autoCleanHands ?? lobbySettings.autoCleanHands ?? false
            }
            lobbySettings = { ...lobbySettings, ...updatedSettings }
            lobbySession.updateState({ settings: { ...lobbySession.state?.settings, ...updatedSettings } })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(updatedSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:actionTimeout", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change settings.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const seconds = Number(value)
            const updateResult = game.updateActionTimeoutFromSeconds(seconds)
            if (!updateResult.ok) {
                await i.reply({ content: "❌ Invalid action timeout.", flags: MessageFlags.Ephemeral }).catch(() => null)
                return
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:rebuyWindow", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change settings.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const seconds = Number(value)

            const newSettings = {
                ...lobbySession.state?.settings,
                allowRebuyMode: lobbySession.state?.settings?.allowRebuyMode ?? lobbySettings?.allowRebuyMode ?? "on",
                rebuyWindowMs: seconds * 1000,
                autoCleanHands: lobbySession.state?.settings?.autoCleanHands ?? lobbySettings?.autoCleanHands ?? false
            }

            lobbySettings = { ...lobbySettings, ...newSettings }
            lobbySession.updateState({ settings: newSettings })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(newSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerPrefixedHandler("tx:settings:autoCleanHands", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can change settings.", flags: MessageFlags.Ephemeral })
            if (lobbySession.isClosed) return i.reply({ content: "⚠️ This table is no longer available.", flags: MessageFlags.Ephemeral })

            const value = Array.isArray(i.values) ? i.values[0] : i.values
            const autoCleanEnabled = value === "on"
            const currentSettings = lobbySession.state?.settings || lobbySettings || {}
            const newSettings = {
                ...currentSettings,
                allowRebuyMode: currentSettings.allowRebuyMode ?? lobbySettings?.allowRebuyMode ?? "on",
                rebuyWindowMs: currentSettings.rebuyWindowMs ?? lobbySettings?.rebuyWindowMs ?? texasSettingDefaults.rebuyWindowMs ?? 60 * 1000,
                autoCleanHands: autoCleanEnabled
            }

            lobbySettings = { ...lobbySettings, ...newSettings }
            lobbySession.updateState({ settings: newSettings })
            if (game && typeof game.applySettings === "function") {
                game.applySettings(newSettings)
            }
            lobbySession.scheduleRefresh()
            await i.deferUpdate().catch(() => null)
        })

        lobbySession.registerComponentHandler("tx:cancel", async (i) => {
            if (i.user.id !== hostId) return i.reply({ content: "❌ Only the host can cancel the game.", flags: MessageFlags.Ephemeral })

            game.rememberPlayerInteraction(i.user.id, i)
            await i.deferUpdate()
            await game.Stop({ reason: "canceled" })
        })

        lobbySession.on("end", async ({ reason }) => {
            if (reason !== "started") {
                await game.Stop({ reason: "canceled" }).catch(
                    buildTexasStopLogger(channel.id, reason || "lobby-end")
                )
            }
        })

    } catch (error) {
        logger.error("Texas command failed", { scope: "commands", command: "texas", error })
        if (game) await game.Stop({ reason: "error" }).catch(buildTexasStopLogger(channel?.id, "command-error"))
        await replyOrEdit({ content: "❌ An error occurred. Please try again.", flags: MessageFlags.Ephemeral })
    } finally {
        if (channel) {
            channel.collector = null
            channel.__texasStarting = false
        }
    }
}

const slashCommand = new SlashCommandBuilder()
    .setName("texas")
    .setDescription("Start a Texas Hold'em game.")
    .addStringOption(o => o.setName("minbet").setDescription("Minimum bet (Small/Big Blind will be MinBet/2 and MinBet).").setRequired(true))
    .addIntegerOption(o => o.setName("maxplayers").setDescription("Maximum number of players (2-9).").setMinValue(2).setMaxValue(9).setRequired(false))

module.exports = createCommand({
    name: "texas",
    description: "Start a Texas Hold'em game.",
    slashCommand,
    deferEphemeral: false,
    execute: runTexas
})
