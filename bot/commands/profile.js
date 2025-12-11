const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js")
const playerClass = require("../games/shared/classes.js")
const setSeparator = require("../../shared/utils/setSeparator")
const { normalizeUserExperience } = require("../../shared/experience")
const { formatRelativeTime, formatTimeUntil, progressBar } = require("../utils/helpers")
const { upgrades } = require("../../config")
const {
    definitions: UPGRADES,
    calculateCost: calculateUpgradeCost,
    calculateValue: calculateUpgradeValue,
    getAllIds: getAllUpgradeIds
} = upgrades
const createCommand = require("../utils/commands/createCommand")
const { sendInteractionResponse } = require("../utils/interactionResponse")
const logger = require("../../shared/logger")
const { logAndSuppress } = logger
const { withAccessGuard } = require("../utils/interactionAccess")
const isUnlockUpgrade = (upgrade) => Boolean(upgrade?.unlockOnly || upgrade?.effect?.strategy === "unlock")
const buildUnlockProgressBar = (isUnlocked) => (isUnlocked ? "🟩" : "🟥").repeat(10)
const upgradeCurrencyDescriptors = Object.freeze({
    money: Object.freeze({
        field: "money",
        label: "money",
        balanceLabel: "balance",
        emoji: "💰",
        suffix: "$"
    }),
    gold: Object.freeze({
        field: "gold",
        label: "gold",
        balanceLabel: "gold balance",
        emoji: "🪙",
        suffix: " Gold"
    })
})
const getCurrencyDescriptor = (upgrade) => upgrade?.currency === "gold"
    ? upgradeCurrencyDescriptors.gold
    : upgradeCurrencyDescriptors.money
const formatCurrencyAmount = (value, descriptor) => `${setSeparator(Math.max(0, Number(value) || 0))}${descriptor.suffix}`
const formatCostIndicator = (cost, descriptor) => `${descriptor.emoji} **${formatCurrencyAmount(cost, descriptor)}**`

const slashCommand = new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show your Chipsy profile and manage upgrades.")
    .addUserOption(option =>
        option
            .setName("user")
            .setDescription("View another player's profile (view only)")
            .setRequired(false)
    )

module.exports = createCommand({
    name: "profile",
    description: "Show your Chipsy profile and manage upgrades.",
    aliases: ["stats"],
    slashCommand,
    deferEphemeral: true, // Defer to allow time for database fetch
    errorMessage: "Unable to load your profile right now. Please try again later.",
    execute: async(interaction, client) => {
        const buildComponentLog = (target = interaction, message, extraMeta = {}) =>
            logAndSuppress(message, {
                scope: "commands.profile",
                interactionId: target?.id || interaction?.id,
                channelId: target?.channel?.id || target?.channelId || interaction?.channelId,
                userId: target?.user?.id || interaction?.user?.id,
                ...extraMeta
            })

        const respond = (payload = {}) => sendInteractionResponse(interaction, payload)

        const ensureProfileLoaded = async(user, { allowCreate = true } = {}) => {
            if (!user?.id) {
                return { error: { type: "invalid-user" } }
            }

            if (allowCreate && typeof client?.SetData === "function") {
                return client.SetData(user)
            }

            if (!client?.dataHandler || typeof client.dataHandler.getUserData !== "function") {
                return { error: { type: "data-handler-unavailable" } }
            }

            try {
                const existing = await client.dataHandler.getUserData(user.id)
                if (!existing) {
                    return { error: { type: "not-found" } }
                }
                user.data = existing
                return { data: existing, created: false }
            } catch (error) {
                return {
                    error: {
                        type: "database",
                        message: error.message
                    }
                }
            }
        }

        const author = interaction.user
        const targetUser = interaction.options.getUser("user") || author
        const isViewingOther = targetUser.id !== author.id
        const profileUser = targetUser.id === author.id ? author : targetUser
        const targetIsBot = profileUser?.bot || profileUser?.system

        if (!author) {
            await respond({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to resolve your Discord account details.")],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        if (targetIsBot) {
            await respond({
                embeds: [new EmbedBuilder().setColor(Colors.Orange).setDescription("⚠️ Bot profiles are unavailable.")],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const viewerProfile = await ensureProfileLoaded(author, { allowCreate: true })
        if (viewerProfile.error) {
            await respond({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Unable to load your profile data. Please try again later.")],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        const targetLoad = await ensureProfileLoaded(profileUser, { allowCreate: !isViewingOther })
        if (targetLoad?.error) {
            const message = isViewingOther
                ? (targetLoad.error.type === "not-found"
                    ? "⚠️ That player has not joined Chipsy yet."
                    : "❌ Unable to load that player's profile data. Please try again later.")
                : "❌ Unable to load your profile data. Please try again later."
            await respond({
                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(message)],
                flags: MessageFlags.Ephemeral
            })
            return
        }

        // Build message - if viewing another user, don't show interactive components
        const { embed, components } = buildProfileMessage(profileUser, { showSelectMenu: false, viewOnly: isViewingOther, showUpgrades: false })
        const message = await respond({ embeds: [embed], components })

        // Set up component collector for buttons and select menu (only if viewing own profile)
        if (components.length > 0 && !isViewingOther) {
            const componentFilter = withAccessGuard(
                (i) => i.user.id === author.id,
                { scope: "profile:components" }
            )
            const collector = message.createMessageComponentCollector({
                filter: componentFilter,
                time: 180000 // 3 minutes
            })

            let state = {
                showSelectMenu: false,
                selectedUpgrade: null,
                showUpgrades: false,
                showSettingsMenu: false,
                selectedSetting: null
            }

            collector.on("collect", async(componentInteraction) => {
                try {
                    const customId = componentInteraction.customId
                    const logComponentError = (message, meta = {}) =>
                        buildComponentLog(componentInteraction, message, {
                            customId,
                            ...meta
                        })
                    const handleProfilePromiseRejection = logComponentError("Profile interaction promise rejected")

                    // Handle toggling upgrade visibility
                    if (customId === `profile_toggle_upgrades:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch (error) {
                            logComponentError("Failed to defer toggle upgrades interaction", { error: error?.message })
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to notify about unavailable profile")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showUpgrades = !state.showUpgrades

                        // Re-render with updated state
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        try {
                            await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents })
                        } catch (error) {
                            logger.warn("Failed to edit profile message", {
                                scope: "commands.profile",
                                channelId: interaction.channel?.id,
                                error: error?.message
                            })
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to warn about unavailable profile on edit failure")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        }
                        return
                    }

                    // Handle Info button
                    if (customId === `profile_info:${author.id}`) {
                        await componentInteraction.deferUpdate()

                        const infoEmbed = new EmbedBuilder()
                            .setColor(Colors.Blue)
                            .setTitle("📚 Upgrade System Guide")
                            .setDescription("Upgrades are permanent improvements that enhance your Chipsy experience. Invest wisely to maximize your earnings!")

                        // Add all upgrade info fields
                        getAllUpgradeIds().forEach(upgradeId => {
                            const upgrade = UPGRADES[upgradeId]
                            infoEmbed.addFields({
                                name: `${upgrade.emoji} ${upgrade.name}`,
                                value: `${upgrade.description}\n\n*${upgrade.details}*`,
                                inline: false
                            })
                        })

                        infoEmbed.addFields({
                            name: "💡 Tip",
                            value: "Upgrades stack and provide long-term value. Focus on upgrading what matters most to your playstyle!",
                            inline: false
                        })
                        infoEmbed.setFooter({ text: "Close this to return to your profile" })

                        await componentInteraction.followUp({
                            embeds: [infoEmbed],
                            flags: MessageFlags.Ephemeral
                        })
                        return
                    }

                    // Handle Exit button - close profile
                    if (customId === `profile_exit:${author.id}`) {
                        await componentInteraction.deferUpdate()
                        if (collector && !collector.ended) collector.stop("exit")
                        await interaction.deleteReply().catch(() => null)
                        return
                    }

                    // Handle Settings button - show settings menu
                    if (customId === `profile_show_settings:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch (error) {
                            logComponentError("Failed to defer show settings interaction", { error: error?.message })
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to warn about unavailable profile (settings)")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSettingsMenu = true
                        state.showSelectMenu = false
                        state.selectedSetting = null

                        // Re-render with settings menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async(error) => {
                            logComponentError("Failed to edit profile view when showing settings", { error: error?.message })
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to warn about unavailable profile after edit failure (settings)")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
                        return
                    }

                    // Handle Cancel Setting button - hide settings menu
                    if (customId === `profile_cancel_setting:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch (error) {
                            logComponentError("Failed to defer cancel setting interaction", { error: error?.message })
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to warn about unavailable profile (cancel setting)")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSettingsMenu = false
                        state.selectedSetting = null

                        // Re-render without settings menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async(error) => {
                            logComponentError("Failed to edit profile view when canceling setting", { error: error?.message })
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(
                                logComponentError("Failed to warn about unavailable profile after edit failure (cancel setting)")
                            )
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
                        return
                    }

                    // Handle Settings Select Menu
                    if (customId === `profile_select_setting:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.selectedSetting = componentInteraction.values[0]
                        return
                    }

                    // Handle Confirm Setting button
                    if (customId === `profile_confirm_setting:${author.id}`) {
                        if (!state.selectedSetting) {
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Please select a setting from the menu first!")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            return
                        }

                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }

                        // Reload fresh data
                        if (client && typeof client.SetData === "function") {
                            await client.SetData(author)
                        }

                        const freshData = normalizeUserExperience(author.data || {})
                        author.data = freshData

                        // Apply setting change
                        if (state.selectedSetting === "toggle_bankroll_privacy") {
                            const newValue = freshData.bankroll_private === 1 ? 0 : 1
                            freshData.bankroll_private = newValue

                            // Save to database
                            const dataHandler = client?.dataHandler
                            if (dataHandler) {
                                await dataHandler.updateUserData(author.id, dataHandler.resolveDBUser(author))
                            }

                            // Reset state and re-render
                            state.showSettingsMenu = false
                            state.selectedSetting = null

                            const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                            const editSuccess = await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                                await componentInteraction.followUp({
                                    embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ Bankroll privacy ${newValue === 1 ? "enabled" : "disabled"}!\n\n⚠️ Profile view expired. Use \`/profile\` to see updated settings.`)],
                                    flags: MessageFlags.Ephemeral
                                }).catch(handleProfilePromiseRejection)
                                if (collector && !collector.ended) collector.stop("message_deleted")
                                return null
                            })

                            // Only send success message if edit succeeded
                            if (editSuccess) {
                                await componentInteraction.followUp({
                                    embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`✅ Bankroll privacy ${newValue === 1 ? "enabled" : "disabled"}! ${newValue === 1 ? "🔒 Others cannot see your money and gold." : "🔓 Others can see your money and gold."}`)],
                                    flags: MessageFlags.Ephemeral
                                }).catch(handleProfilePromiseRejection)
                            }
                        }
                        return
                    }

                    // Handle Upgrade button - show select menu
                    if (customId === `profile_show_upgrades:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSelectMenu = true
                        state.selectedUpgrade = null

                        // Re-render with select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
                        return
                    }

                    // Handle Cancel button - hide select menu
                    if (customId === `profile_cancel_upgrade:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            // Interaction failed - try to send error message
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSelectMenu = false
                        state.selectedUpgrade = null

                        // Re-render without select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            // Message no longer exists, notify user
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
                        return
                    }

                    // Handle Select Menu
                    if (customId === `profile_select_upgrade:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            // Interaction failed - try to send error message
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.selectedUpgrade = componentInteraction.values[0]
                        return
                    }

                    // Handle Confirm Purchase button
                    if (customId === `profile_confirm_purchase:${author.id}`) {
                        if (!state.selectedUpgrade) {
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Please select an upgrade from the menu first!")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            return
                        }

                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            // Interaction failed - try to send error message
                            await componentInteraction.reply({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ This profile view is no longer available. Please use `/profile` again.")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }

                        // Reload fresh data
                        if (client && typeof client.SetData === "function") {
                            await client.SetData(author)
                        }

                        const freshData = normalizeUserExperience(author.data || {})
                        author.data = freshData

                        const upgrade = UPGRADES[state.selectedUpgrade]
                        if (!upgrade) {
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ Invalid upgrade selection!")],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            return
                        }
                        const currencyDescriptor = getCurrencyDescriptor(upgrade)
                        const balanceField = currencyDescriptor.field
                        const currentBalance = Number(freshData[balanceField]) || 0
                        const unlockUpgrade = isUnlockUpgrade(upgrade)
                        const currentLevel = freshData[upgrade.dbField] || 0
                        const maxLevel = upgrade.maxLevel

                        if (currentLevel >= maxLevel) {
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(unlockUpgrade
                                    ? `❌ ${upgrade.emoji} **${upgrade.name}** is already unlocked!`
                                    : `❌ ${upgrade.emoji} **${upgrade.name}** is already at maximum level!`)],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            return
                        }

                        const cost = calculateUpgradeCost(state.selectedUpgrade, currentLevel)

                        if (currentBalance < cost) {
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription(`❌ You need ${formatCostIndicator(cost, currencyDescriptor)} to buy this upgrade!\n${currencyDescriptor.emoji} Your ${currencyDescriptor.label}: **${formatCurrencyAmount(currentBalance, currencyDescriptor)}**`)],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            return
                        }

                        // Apply upgrade
                        freshData[balanceField] = Math.max(0, currentBalance - cost)
                        freshData[upgrade.dbField] = currentLevel + 1

                        // Save to database
                        const dataHandler = client?.dataHandler
                        if (dataHandler) {
                            await dataHandler.updateUserData(author.id, dataHandler.resolveDBUser(author))
                        }

                        // Reset state and re-render
                        state.showSelectMenu = false
                        state.selectedUpgrade = null

                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(profileUser, state)
                        const successHeadline = unlockUpgrade
                            ? `${upgrade.emoji} **${upgrade.name}** unlocked!`
                            : `${upgrade.emoji} **${upgrade.name}** upgraded to level **${freshData[upgrade.dbField]}**!`
                        const insightLine = unlockUpgrade
                            ? "\n🔮 Win probability insights now show up in Blackjack and Texas Hold'em."
                            : ""
                        const balanceLine = `${currencyDescriptor.emoji} New ${currencyDescriptor.balanceLabel}: **${formatCurrencyAmount(freshData[balanceField], currencyDescriptor)}**`
                        const baseSuccessMessage = `✅ ${successHeadline}\n${balanceLine}${insightLine}`

                        const editSuccess = await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            // Message no longer exists, notify user with upgrade confirmation
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(`${baseSuccessMessage}\n\n⚠️ Profile view expired. Use \`/profile\` to see updated stats.`)],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return null
                        })

                        // Only send success message if edit succeeded
                        if (editSuccess) {
                            await componentInteraction.followUp({
                                embeds: [new EmbedBuilder().setColor(Colors.Green).setDescription(baseSuccessMessage)],
                                flags: MessageFlags.Ephemeral
                            }).catch(handleProfilePromiseRejection)
                        }
                    }

                } catch (error) {
                    logger.error("Error handling profile interaction", {
                        scope: "commands",
                        command: "profile",
                        userId: author.id,
                        error: error.message,
                        stack: error.stack
                    })

                    if (!componentInteraction.replied && !componentInteraction.deferred) {
                        await componentInteraction.reply({
                            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ An error occurred. Please try again.")],
                            flags: MessageFlags.Ephemeral
                        }).catch(handleProfilePromiseRejection)
                    } else {
                        await componentInteraction.followUp({
                            embeds: [new EmbedBuilder().setColor(Colors.Red).setDescription("❌ An error occurred. Please try again.")],
                            flags: MessageFlags.Ephemeral
                        }).catch(handleProfilePromiseRejection)
                    }
                }
            })

            collector.on("end", () => {
                // Disable all components after collector ends
                const { components: latestComponents } = buildProfileMessage(profileUser, state)
                const disabledComponents = latestComponents.map((row) => {
                    const newRow = ActionRowBuilder.from(row)
                    newRow.components.forEach((component) => {
                        if (typeof component.setDisabled === "function") {
                            component.setDisabled(true)
                        }
                    })
                    return newRow
                })

                interaction.editReply({ components: disabledComponents }).catch((error) => {
                    logger.warn("Failed to disable profile components after collector end", {
                        scope: "commands.profile",
                        channelId: interaction.channel?.id,
                        error: error?.message
                    })
                    return null
                })
            })
        }
    }
})

// Helper function to build profile message
function buildProfileMessage(author, state = {}) {
    const viewOnly = state.viewOnly === true
    // Don't show interactive components if viewing another player's profile
    const data = normalizeUserExperience(author.data || {})
    author.data = data
    const avatarURL = author.displayAvatarURL({ extension: "png" })

    const now = Date.now()
    const nextReward = data.next_reward ? new Date(data.next_reward) : null
    const rewardAvailable = !nextReward || now >= nextReward.getTime()
    const timeUntilReward = rewardAvailable ? "Available now! Use `/reward`" : formatTimeUntil(nextReward)

    const winLossRatio = data.hands_played > 0 ? (data.hands_won / data.hands_played) * 100 : 0
    const winLossRatioString = `${winLossRatio.toFixed(1)}%`
    const joinDate = new Date(data.join_date).toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" })

    const trimZeros = (value) => value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "")
    const formatPercentageValue = (value, { showMinus = false } = {}) => {
        if (!Number.isFinite(value) || value === 0) {
            return "—"
        }
        const sign = showMinus ? "-" : "+"
        const percent = trimZeros((Math.abs(value) * 100).toFixed(3))
        return `${sign}${percent}%`
    }
    const formatCurrencyValue = (value, { prefix = "+" } = {}) => {
        if (!Number.isFinite(value) || value === 0) {
            return `${prefix}0$`
        }
        const rounded = Math.round(value)
        return `${prefix}${setSeparator(rounded)}$`
    }
    const formatHoursValue = (value) => {
        if (!Number.isFinite(value)) return "—"
        const rounded = Number.isInteger(value) ? value : parseFloat(value.toFixed(1))
        return `${rounded}h`
    }
    const resolveUpgradeValue = (upgrade, level) => {
        const safeLevel = Math.min(level, upgrade.maxLevel)
        let result = calculateUpgradeValue(upgrade.id, safeLevel)
        if (upgrade.id === "withholding") {
            result *= upgrade.blackjackMultiplier * upgrade.effectMultiplier
        }
        return result
    }
    const formatUpgradeValue = (upgrade, value) => {
        if (!Number.isFinite(value)) return "—"
        if (upgrade.id === "withholding") {
            return formatPercentageValue(value, { showMinus: true })
        }
        if (upgrade.id === "reward_amount") {
            return formatCurrencyValue(value, { prefix: "+" })
        }
        if (upgrade.id === "reward_time") {
            return formatHoursValue(value)
        }
        if (typeof upgrade.format === "function") {
            return (upgrade.formatPrefix || "") + upgrade.format(value)
        }
        return value.toString()
    }

    const upgradeEntries = []

    getAllUpgradeIds().forEach((upgradeId) => {
        const upgrade = UPGRADES[upgradeId]
        if (!upgrade) return
        const currentLevel = data[upgrade.dbField] || 0
        const maxLevel = upgrade.maxLevel
        const currentValue = resolveUpgradeValue(upgrade, currentLevel)
        const hasNextLevel = currentLevel < maxLevel
        const upgradeCost = hasNextLevel ? calculateUpgradeCost(upgradeId, currentLevel) : null
        const descriptor = getCurrencyDescriptor(upgrade)
        const costDisplay = hasNextLevel && Number.isFinite(upgradeCost)
            ? formatCostIndicator(upgradeCost, descriptor)
            : "✅ **MAX LEVEL**"

        const lines = []

        if (isUnlockUpgrade(upgrade)) {
            const unlocked = currentLevel >= maxLevel
            lines.push(`${buildUnlockProgressBar(unlocked)}\n`)
            lines.push(unlocked ? "🟢 Unlocked" : "🪄 Locked (-> Unlocked)")
        } else {
            const nextValue = hasNextLevel
                ? resolveUpgradeValue(upgrade, currentLevel + 1)
                : null
            const bar = progressBar(currentLevel, maxLevel)
            const nextLabel = nextValue !== null && Number.isFinite(nextValue)
                ? `(**${formatUpgradeValue(upgrade, currentValue)}** -> **${formatUpgradeValue(upgrade, nextValue)}**)`
                : "(**Maxed out**)"
            lines.push(`${bar}\n`)
            lines.push(`⬆️ **${currentLevel}/${maxLevel}** ${nextLabel}`)
        }

        lines.push(costDisplay)

        upgradeEntries.push({
            name: `${upgrade.name} ${upgrade.emoji}`,
            value: lines.join("\n")
        })
    })

    // Determine privacy for balance field (needs to be before embed creation)
    const balancePrivate = data.bankroll_private === 1 && viewOnly

    const className = playerClass.getUserClass(data.money)
    const classLabel = balancePrivate ? null : className
    const titleSuffix = classLabel ? ` | 🔰 ${classLabel}` : ""

    const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`${author.username}'s Chipsy Profile${titleSuffix}`)
        .addFields(
            {
                name: "Money 💰",
                value: balancePrivate ? "Private" : `${setSeparator(data.money)}$`,
                inline: true
            },
            {
                name: "Gold 🪙",
                value: balancePrivate ? "Private" : `${setSeparator(data.gold)}`,
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false },
            {
                name: "Experience ⭐",
                value: `Level: **${setSeparator(data.level)}**\nExp: **${setSeparator(data.current_exp)}/${setSeparator(data.required_exp)}**`,
                inline: true
            },
            {
                name: "Statistics 📊",
                value: `W/L Ratio: **${winLossRatioString}**\nHands played: **${setSeparator(data.hands_played)}**\nHands won: **${setSeparator(data.hands_won)}**\nBiggest bet: **${setSeparator(data.biggest_bet)}$**\nBiggest won: **${setSeparator(data.biggest_won)}$**`,
                inline: true
            },
            { name: '\u200B', value: '\u200B', inline: false },
            {
                name: "Player Since 📅",
                value: `${joinDate}`,
                inline: true
            },
            {
                name: "Next Gift ⏰",
                value: `${timeUntilReward}`,
                inline: true
            }
        )

    if (state.showUpgrades && upgradeEntries.length > 0) {
        const spacer = () => ({ name: "\u200B", value: "\u200B", inline: false })
        const fillerField = { name: "\u200B", value: "\u200B", inline: true }
        const upgradeFields = []
        for (let index = 0; index < upgradeEntries.length; index += 2) {
            const rowEntries = upgradeEntries
                .slice(index, index + 2)
                .map((entry) => ({ ...entry, inline: true }))
            if (rowEntries.length === 1) {
                rowEntries.push({ ...fillerField })
            }
            upgradeFields.push(spacer(), ...rowEntries)
        }
        upgradeFields.push(spacer())
        embed.addFields(...upgradeFields)
    }

    embed.setThumbnail(avatarURL)
        .setFooter({ text: `Last played: ${formatRelativeTime(data.last_played)}` })

    const components = []

    // Don't show interactive components if viewing another player's profile

    // Check if there are any upgrades available
    const hasAvailableUpgrades = getAllUpgradeIds().some(upgradeId => {
        const upgrade = UPGRADES[upgradeId]
        const currentLevel = data[upgrade.dbField] || 0
        return currentLevel < upgrade.maxLevel
    })

    if (!viewOnly && state.showSelectMenu && hasAvailableUpgrades) {
        // Build select menu with available upgrades
        const selectOptions = []

        getAllUpgradeIds().forEach(upgradeId => {
            const upgrade = UPGRADES[upgradeId]
            const currentLevel = data[upgrade.dbField] || 0
            const maxLevel = upgrade.maxLevel

            if (currentLevel < maxLevel) {
                const cost = calculateUpgradeCost(upgradeId, currentLevel)
                const descriptor = getCurrencyDescriptor(upgrade)
                const availableBalance = Number(data[descriptor.field]) || 0
                const canAfford = availableBalance >= cost
                const unlockUpgrade = isUnlockUpgrade(upgrade)
                const costLabel = `${descriptor.emoji} ${formatCurrencyAmount(cost, descriptor)}`
                selectOptions.push({
                    label: unlockUpgrade ? `${upgrade.name} (Unlock)` : `${upgrade.name} (Lvl ${currentLevel + 1})`,
                    description: `${costLabel} ${canAfford ? "✓" : `✗ Not enough ${descriptor.label}`}`,
                    value: upgradeId,
                    emoji: upgrade.emoji
                })
            }
        })

        if (selectOptions.length > 0) {
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`profile_select_upgrade:${author.id}`)
                .setPlaceholder("Select an upgrade to purchase...")
                .addOptions(selectOptions)

            components.push(new ActionRowBuilder().addComponents(selectMenu))
        }

        // Confirm/Cancel buttons row
        const actionRow = new ActionRowBuilder()

        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_confirm_purchase:${author.id}`)
                .setLabel("Confirm Purchase")
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅")
        )

        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_cancel_upgrade:${author.id}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("❌")
        )

        components.push(actionRow)

    } else if (!viewOnly && state.showSettingsMenu) {
        // Show settings menu with privacy options
        const settingsOptions = [
            {
                label: data.bankroll_private === 1 ? "Make bankroll public" : "Make bankroll private",
                description: data.bankroll_private === 1 ? "Others will see your money and gold" : "Hide your money and gold from others",
                value: "toggle_bankroll_privacy",
                emoji: data.bankroll_private === 1 ? "🔓" : "🔒"
            }
        ]

        const settingsMenu = new StringSelectMenuBuilder()
            .setCustomId(`profile_select_setting:${author.id}`)
            .setPlaceholder("Select a setting to change...")
            .addOptions(settingsOptions)

        components.push(new ActionRowBuilder().addComponents(settingsMenu))

        // Confirm/Cancel buttons row
        const actionRow = new ActionRowBuilder()

        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_confirm_setting:${author.id}`)
                .setLabel("Confirm Change")
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅")
        )

        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_cancel_setting:${author.id}`)
                .setLabel("Cancel")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("❌")
        )

        components.push(actionRow)

    } else if (!viewOnly) {
        // Initial state - just show Upgrade, Settings and Info buttons (only if not view-only)
        const buttonRow = new ActionRowBuilder()

        if (hasAvailableUpgrades) {
            buttonRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`profile_show_upgrades:${author.id}`)
                    .setLabel("Upgrade")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("💰")
            )
        }

        buttonRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_show_settings:${author.id}`)
                .setLabel("Settings")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("⚙️")
        )

        if (hasAvailableUpgrades) {
            buttonRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`profile_toggle_upgrades:${author.id}`)
                    .setLabel(state.showUpgrades ? "Show less" : "Show more")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(state.showUpgrades ? "🔼" : "🔽")
            )
        }

        buttonRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_info:${author.id}`)
                .setLabel("Info")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("ℹ️")
        )

        buttonRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`profile_exit:${author.id}`)
                .setLabel("Exit")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("🚪")
        )

        components.push(buttonRow)
    }

    return { embed, components }
}
