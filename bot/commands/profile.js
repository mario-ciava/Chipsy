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
        const { embed, components } = buildProfileMessage(targetUser, { showSelectMenu: false, viewOnly: isViewingOther })
        const message = await respond({ embeds: [embed], components })

        // Set up component collector for buttons and select menu (only if viewing own profile)
        if (components.length > 0 && !isViewingOther) {
            const collector = message.createMessageComponentCollector({
                filter: (i) => i.user.id === author.id,
                time: 180000 // 3 minutes
            })

            let state = {
                showSelectMenu: false,
                selectedUpgrade: null
            }

            collector.on("collect", async(componentInteraction) => {
                try {
                    const customId = componentInteraction.customId

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
                            ephemeral: true
                        })
                        return
                    }

                    // Handle Upgrade button - show select menu
                    if (customId === `profile_show_upgrades:${author.id}`) {
                        await componentInteraction.deferUpdate()
                        state.showSelectMenu = true
                        state.selectedUpgrade = null

                        // Re-render with select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await message.edit({ embeds: [updatedEmbed], components: updatedComponents })
                        return
                    }

                    // Handle Cancel button - hide select menu
                    if (customId === `profile_cancel_upgrade:${author.id}`) {
                        await componentInteraction.deferUpdate()
                        state.showSelectMenu = false
                        state.selectedUpgrade = null

                        // Re-render without select menu
                        const { embed: updatedEmbed, components: updatedComponents } = buildProfileMessage(author, state)
                        await message.edit({ embeds: [updatedEmbed], components: updatedComponents })
                        return
                    }

                    // Handle Select Menu
                    if (customId === `profile_select_upgrade:${author.id}`) {
                        await componentInteraction.deferUpdate()
                        state.selectedUpgrade = componentInteraction.values[0]
                        return
                    }

                    // Handle Confirm Purchase button
                    if (customId === `profile_confirm_purchase:${author.id}`) {
                        if (!state.selectedUpgrade) {
                            await componentInteraction.reply({
                                content: "❌ Please select an upgrade from the menu first!",
                                ephemeral: true
                            })
                            return
                        }

                        await componentInteraction.deferUpdate()

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
                                ephemeral: true
                            })
                            return
                        }

                        const currentLevel = freshData[upgrade.dbField] || 0
                        const maxLevel = upgrade.maxLevel

                        if (currentLevel >= maxLevel) {
                            await componentInteraction.followUp({
                                content: `❌ ${upgrade.emoji} **${upgrade.name}** is already at maximum level!`,
                                ephemeral: true
                            })
                            return
                        }

                        const cost = calculateUpgradeCost(state.selectedUpgrade, currentLevel)

                        if (freshData.money < cost) {
                            await componentInteraction.followUp({
                                content: `❌ You need **${setSeparator(cost)}$** to buy this upgrade!\n💰 Your balance: **${setSeparator(freshData.money)}$**`,
                                ephemeral: true
                            })
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
                        await message.edit({ embeds: [updatedEmbed], components: updatedComponents })

                        await componentInteraction.followUp({
                            content: `✅ ${upgrade.emoji} **${upgrade.name}** upgraded to level **${freshData[upgrade.dbField]}**!\n💰 New balance: **${setSeparator(freshData.money)}$**`,
                            ephemeral: true
                        })
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
                            ephemeral: true
                        }).catch(() => null)
                    } else {
                        await componentInteraction.followUp({
                            content: "❌ An error occurred. Please try again.",
                            ephemeral: true
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

                message.edit({ components: disabledComponents }).catch(() => null)
            })
        }
    }
})

// Helper function to build profile message
function buildProfileMessage(author, state = {}) {
    const data = normalizeUserExperience(author.data || {})
    const avatarURL = author.displayAvatarURL({ extension: "png" })

    const now = Date.now()
    const nextReward = data.next_reward ? new Date(data.next_reward) : null
    const rewardAvailable = !nextReward || now >= nextReward.getTime()
    const timeUntilReward = rewardAvailable ? "Available now! Use `/reward`" : formatTimeUntil(nextReward)

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

    const embed = new EmbedBuilder()
        .setColor(Colors.Gold)
        .setTitle(`${author.username}'s Chipsy Profile`)
        .addFields(
            {
                name: "Balance 💰",
                value: `Money: **${setSeparator(data.money)}$**\nGold: **${setSeparator(data.gold)}**`,
                inline: true
            },
            {
                name: "Experience ⭐",
                value: `Level: **${setSeparator(data.level)}**\nExp: **${setSeparator(data.current_exp)}/${setSeparator(data.required_exp)}**`,
                inline: true
            },
            {
                name: "Class 🔰",
                value: playerClass.getUserClass(data.money),
                inline: true
            },
            {
                name: "Records 🔝",
                value: `Biggest bet: **${setSeparator(data.biggest_bet)}$**\nBiggest won: **${setSeparator(data.biggest_won)}$**`,
                inline: true
            },
            {
                name: "Statistics 🃏",
                value: `Hands played: **${setSeparator(data.hands_played)}**\nHands won: **${setSeparator(data.hands_won)}**`,
                inline: true
            },
            {
                name: "Next Reward ⏰",
                value: `${rewardAvailable ? "✅" : "⏳"} ${timeUntilReward}`,
                inline: true
            },
            ...upgradeFields
        )
        .setThumbnail(avatarURL)
        .setFooter({ text: `Last played: ${formatRelativeTime(data.last_played)}` })

    const components = []

    // Don't show interactive components if viewing another player's profile
    const viewOnly = state.viewOnly === true

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

    } else if (!viewOnly) {
        // Initial state - just show Upgrade and Info buttons (only if not view-only)
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
                .setCustomId(`profile_info:${author.id}`)
                .setLabel("Info")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("ℹ️")
        )

        components.push(buttonRow)
    }

    return { embed, components }
}
