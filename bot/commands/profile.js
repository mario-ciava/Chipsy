const { SlashCommandBuilder, EmbedBuilder, Colors, MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js")
const playerClass = require("../games/classes.js")
const setSeparator = require("../utils/setSeparator")
const { normalizeUserExperience } = require("../utils/experience")
const { formatRelativeTime, formatTimeUntil, progressBar } = require("../utils/helpers")
const { UPGRADES, calculateUpgradeCost, calculateUpgradeValue, getAllUpgradeIds } = require("../../config/upgrades")
const createCommand = require("../utils/createCommand")
const logger = require("../utils/logger")

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
        const respond = async(payload = {}) => {
            if (interaction.deferred && !interaction.replied) {
                return interaction.editReply(payload)
            }
            if (!interaction.replied) {
                return interaction.reply(payload)
            }
            return interaction.followUp(payload)
        }

        const author = interaction.user
        const targetUser = interaction.options.getUser("user") || author
        const isViewingOther = targetUser.id !== author.id

        if (!author) {
            await respond({
                content: "❌ Unable to resolve your Discord account details.",
                flags: MessageFlags.Ephemeral
            })
            return
        }

        // Force reload data from database to ensure freshness
        if (client && typeof client.SetData === "function") {
            const result = await client.SetData(targetUser)
            if (result.error) {
                await respond({
                    content: `❌ Unable to load ${isViewingOther ? "that player's" : "your"} profile data. Please try again later.`,
                    flags: MessageFlags.Ephemeral
                })
                return
            }
        }

        // Build message - if viewing another user, don't show interactive components
        const { embed, components } = buildProfileMessage(targetUser, { showSelectMenu: false, viewOnly: isViewingOther, showUpgrades: false })
        const message = await respond({ embeds: [embed], components })

        // Set up component collector for buttons and select menu (only if viewing own profile)
        if (components.length > 0 && !isViewingOther) {
            const collector = message.createMessageComponentCollector({
                filter: (i) => i.user.id === author.id,
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

                    // Handle toggling upgrade visibility
                    if (customId === `profile_toggle_upgrades:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showUpgrades = !state.showUpgrades

                        // Re-render with updated state
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
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

                    // Handle Settings button - show settings menu
                    if (customId === `profile_show_settings:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSettingsMenu = true
                        state.showSelectMenu = false
                        state.selectedSetting = null

                        // Re-render with settings menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                        })
                        return
                    }

                    // Handle Cancel Setting button - hide settings menu
                    if (customId === `profile_cancel_setting:${author.id}`) {
                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSettingsMenu = false
                        state.selectedSetting = null

                        // Re-render without settings menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ Please select a setting from the menu first!",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            return
                        }

                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            await componentInteraction.reply({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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

                            const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                            const editSuccess = await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                                await componentInteraction.followUp({
                                    content: `✅ Bankroll privacy ${newValue === 1 ? "enabled" : "disabled"}!\n\n⚠️ Profile view expired. Use \`/profile\` to see updated settings.`,
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => null)
                                if (collector && !collector.ended) collector.stop("message_deleted")
                                return null
                            })

                            // Only send success message if edit succeeded
                            if (editSuccess) {
                                await componentInteraction.followUp({
                                    content: `✅ Bankroll privacy ${newValue === 1 ? "enabled" : "disabled"}! ${newValue === 1 ? "🔒 Others cannot see your money and gold." : "🔓 Others can see your money and gold."}`,
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => null)
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
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSelectMenu = true
                        state.selectedUpgrade = null

                        // Re-render with select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return
                        }
                        state.showSelectMenu = false
                        state.selectedUpgrade = null

                        // Re-render without select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            // Message no longer exists, notify user
                            await componentInteraction.followUp({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ Please select an upgrade from the menu first!",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            return
                        }

                        try {
                            await componentInteraction.deferUpdate()
                        } catch {
                            // Interaction failed - try to send error message
                            await componentInteraction.reply({
                                content: "❌ This profile view is no longer available. Please use `/profile` again.",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                                content: "❌ Invalid upgrade selection!",
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            return
                        }

                        const currentLevel = freshData[upgrade.dbField] || 0
                        const maxLevel = upgrade.maxLevel

                        if (currentLevel >= maxLevel) {
                            await componentInteraction.followUp({
                                content: `❌ ${upgrade.emoji} **${upgrade.name}** is already at maximum level!`,
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            return
                        }

                        const cost = calculateUpgradeCost(state.selectedUpgrade, currentLevel)

                        if (freshData.money < cost) {
                            await componentInteraction.followUp({
                                content: `❌ You need **${setSeparator(cost)}$** to buy this upgrade!\n💰 Your balance: **${setSeparator(freshData.money)}$**`,
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            return
                        }

                        // Apply upgrade
                        freshData.money -= cost
                        freshData[upgrade.dbField] = currentLevel + 1

                        // Save to database
                        const dataHandler = client?.dataHandler
                        if (dataHandler) {
                            await dataHandler.updateUserData(author.id, dataHandler.resolveDBUser(author))
                        }

                        // Reset state and re-render
                        state.showSelectMenu = false
                        state.selectedUpgrade = null

                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        const editSuccess = await interaction.editReply({ embeds: [updatedEmbed], components: updatedComponents }).catch(async() => {
                            // Message no longer exists, notify user with upgrade confirmation
                            await componentInteraction.followUp({
                                content: `✅ ${upgrade.emoji} **${upgrade.name}** upgraded to level **${freshData[upgrade.dbField]}**!\n💰 New balance: **${setSeparator(freshData.money)}$**\n\n⚠️ Profile view expired. Use \`/profile\` to see updated stats.`,
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
                            if (collector && !collector.ended) collector.stop("message_deleted")
                            return null
                        })

                        // Only send success message if edit succeeded
                        if (editSuccess) {
                            await componentInteraction.followUp({
                                content: `✅ ${upgrade.emoji} **${upgrade.name}** upgraded to level **${freshData[upgrade.dbField]}**!\n💰 New balance: **${setSeparator(freshData.money)}$**`,
                                flags: MessageFlags.Ephemeral
                            }).catch(() => null)
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
                            content: "❌ An error occurred. Please try again.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => null)
                    } else {
                        await componentInteraction.followUp({
                            content: "❌ An error occurred. Please try again.",
                            flags: MessageFlags.Ephemeral
                        }).catch(() => null)
                    }
                }
            })

            collector.on("end", () => {
                // Disable all components after collector ends
                const disabledComponents = components.map((row) => {
                    const newRow = ActionRowBuilder.from(row)
                    newRow.components.forEach((component) => {
                        if (typeof component.setDisabled === 'function') {
                            component.setDisabled(true)
                        }
                    })
                    return newRow
                })

                interaction.editReply({ components: disabledComponents }).catch(() => null)
            })
        }
    }
})

// Helper function to build profile message
function buildProfileMessage(author, state = {}) {
    const viewOnly = state.viewOnly === true
    // Don't show interactive components if viewing another player's profile
    const data = normalizeUserExperience(author.data || {})
    const avatarURL = author.displayAvatarURL({ extension: "png" })

    const now = Date.now()
    const nextReward = data.next_reward ? new Date(data.next_reward) : null
    const rewardAvailable = !nextReward || now >= nextReward.getTime()
    const timeUntilReward = rewardAvailable ? "Available now! Use `/reward`" : formatTimeUntil(nextReward)

    const winLossRatio = data.hands_played > 0 ? (data.hands_won / data.hands_played) * 100 : 0
    const winLossRatioString = `${winLossRatio.toFixed(1)}%`
    const joinDate = new Date(data.join_date).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })

    const upgradeFields = []

    // Build upgrade fields dynamically from config
    getAllUpgradeIds().forEach(upgradeId => {
        const upgrade = UPGRADES[upgradeId]
        const currentLevel = data[upgrade.dbField] || 0
        const maxLevel = upgrade.maxLevel

        // Calculate current value
        let currentValue = calculateUpgradeValue(upgradeId, currentLevel)

        // Special handling for withholding in blackjack context
        if (upgradeId === 'withholding') {
            currentValue = currentValue * upgrade.blackjackMultiplier * upgrade.effectMultiplier
        }

        const bar = progressBar(currentLevel, maxLevel)
        const costDisplay = currentLevel < maxLevel
            ? `💰 **${setSeparator(calculateUpgradeCost(upgradeId, currentLevel))}$**`
            : "✅ **MAX LEVEL**"

        // Format value based on upgrade config
        const formattedValue = upgrade.format
            ? (upgrade.formatPrefix || "") + upgrade.format(currentValue)
            : currentValue

        upgradeFields.push({
            name: `${upgrade.emoji} ${upgrade.name}`,
            value: `${bar}\nLevel **${currentLevel}/${maxLevel}** • Current: **${formattedValue}**\nNext upgrade cost: ${costDisplay}`,
            inline: false
        })
    })

    // Determine privacy for balance field (needs to be before embed creation)
    const balancePrivate = data.bankroll_private === 1 && viewOnly

    const className = playerClass.getUserClass(data.money)

    const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`${author.username}'s Chipsy Profile | 🔰 ${className}`)
        .addFields(
            {
                name: "Money 💰",
                value: balancePrivate ? "**Private**" : `**${setSeparator(data.money)}$**`,
                inline: true
            },
            {
                name: "Gold 🪙",
                value: balancePrivate ? "**Private**" : `**${setSeparator(data.gold)}**`,
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
                value: `**${joinDate}**`,
                inline: true
            },
            {
                name: "Next Gift ⏰",
                value: `${timeUntilReward}`,
                inline: true
            }
        )

    if (state.showUpgrades) {
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
                const canAfford = data.money >= cost
                selectOptions.push({
                    label: `${upgrade.name} (Lvl ${currentLevel + 1})`,
                    description: `Cost: ${setSeparator(cost)}$ ${canAfford ? "✓" : "✗ Not enough money"}`,
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

        components.push(buttonRow)
    }

    return { embed, components }
}
