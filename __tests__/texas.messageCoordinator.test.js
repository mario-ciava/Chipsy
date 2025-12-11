jest.mock("discord.js", () => {
    class MockEmbed {
        constructor() {
            this.title = ""
            this.description = ""
            this.fields = []
            this.footer = {}
            this.color = null
            this.image = null
        }
        setColor(color) { this.color = color; return this }
        setTitle(title) { this.title = title; return this }
        setDescription(desc) { this.description = desc; return this }
        addFields(...fields) { this.fields.push(...fields); return this }
        setFooter(footer) { this.footer = footer; return this }
        setImage(image) { this.image = image; return this }
        static from(embed) { return Object.assign(new MockEmbed(), embed) }
    }
    class MockButtonBuilder {
        constructor() { this.customId = null; this.label = null; this.style = null; this.emoji = null }
        setCustomId(id) { this.customId = id; return this }
        setLabel(label) { this.label = label; return this }
        setStyle(style) { this.style = style; return this }
        setEmoji(emoji) { this.emoji = emoji; return this }
        setDisabled() { return this }
    }
    class MockActionRowBuilder {
        constructor() { this.components = [] }
        addComponents(...components) { this.components.push(...components); return this }
        static from(row) {
            const clone = new MockActionRowBuilder()
            clone.components = [...row.components]
            return clone
        }
    }
    return {
        EmbedBuilder: MockEmbed,
        ButtonBuilder: MockButtonBuilder,
        ActionRowBuilder: MockActionRowBuilder,
        ButtonStyle: { Primary: 1, Secondary: 2, Success: 3, Danger: 4 },
        Colors: {
            Green: "#00ff00",
            Red: "#ff0000",
            Blue: "#0000ff",
            Orange: "#ffa500",
            DarkGrey: "#333333",
            Gold: "#ffd700",
            Aqua: "#00ffff",
            Purple: "#800080"
        }
    }
})

const TexasMessageCoordinator = require("../bot/games/texas/messageCoordinator")

describe("TexasMessageCoordinator", () => {
    test("updateGameMessage builds action buttons for available options", async () => {
        const player = {
            id: "p1",
            tag: "Player1",
            bets: { current: 0 },
            stack: 500,
            status: {}
        }
        const broadcast = jest.fn(async (payload) => payload)
        const snapshot = { filename: "table.png", attachment: { name: "table.png" } }
        const game = {
            hands: 2,
            bets: { currentMax: 0, minRaise: 50 },
            inGamePlayers: [player, { id: "p2", status: {} }],
            lastValidSnapshot: null,
            captureTableRender: jest.fn().mockResolvedValue(snapshot),
            buildInfoAndTimelineFields: () => [{ name: "Timeline", value: "No actions yet.", inline: true }, { name: "Info", value: "SB/BB", inline: true }],
            broadcaster: { broadcast },
            getTableMinBet: () => 100,
            actionTimeoutMs: 15000,
            inactiveHands: 0,
            currentHandHasInteraction: false,
            pendingProbabilityTask: null,
            remindAllPlayersHoleCards: jest.fn(),
            holeCardsSent: false,
            isRemotePauseActive: null
        }

        const coordinator = new TexasMessageCoordinator(game)

        await coordinator.updateGameMessage(player, { availableOptions: ["check", "bet", "raise", "allin", "leave"] })

        expect(broadcast).toHaveBeenCalledTimes(1)
        const payload = broadcast.mock.calls[0][0]
        expect(payload.files[0]).toEqual(snapshot.attachment)
        const buttonIds = payload.components.flatMap((row) => row.components.map((btn) => btn.customId))
        expect(buttonIds).toEqual(expect.arrayContaining([
            "tx_action:check:p1",
            "tx_action:bet_fixed:p1:100",
            "tx_action:raise_fixed:p1:50",
            "tx_action:allin:p1",
            "tx_action:leave:p1"
        ]))
    })
})
