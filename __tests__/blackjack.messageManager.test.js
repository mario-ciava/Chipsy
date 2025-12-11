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
            LuminousVividPink: "#ff00ff",
            Purple: "#800080",
            Aqua: "#00ffff"
        }
    }
})

const { BlackjackMessageManager } = require("../bot/games/blackjack/messageManager")

describe("BlackjackMessageManager", () => {
    test("betsOpened builds bet panel with expected buttons", async () => {
        const broadcast = jest.fn(async (payload) => payload)
        const game = {
            hands: 1,
            minBet: 50,
            players: [
                { newEntry: false, stack: 500, toString: () => "<@p1>" },
                { newEntry: false, stack: 250, toString: () => "<@p2>" }
            ],
            getDeckWarning: () => "",
            broadcaster: { broadcast },
            client: { user: { displayAvatarURL: jest.fn(() => "avatar.png") } }
        }
        const manager = new BlackjackMessageManager(game)

        await manager.SendMessage("betsOpened")

        expect(broadcast).toHaveBeenCalledTimes(1)
        const payload = broadcast.mock.calls[0][0]
        const buttonIds = (payload.components || []).flatMap((row) => row.components.map((btn) => btn.customId))
        expect(buttonIds).toEqual(expect.arrayContaining([
            "bj_bet:place",
            "bj_bet:autobet",
            "bj_bet:leave"
        ]))
        expect(payload.embeds[0].title).toContain("Bets opened")
    })
})
