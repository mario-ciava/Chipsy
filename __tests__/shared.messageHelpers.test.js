const {
    formatTimelineStamp,
    resolvePlayerLabel,
    formatPlayerName
} = require("../bot/games/shared/messageHelpers")

describe("shared message helpers", () => {
    test("formatTimelineStamp returns hh:mm:ss for valid dates", () => {
        const date = new Date("2024-02-01T12:34:56Z")
        expect(formatTimelineStamp(date)).toBe("12:34:56")
    })

    test("formatTimelineStamp falls back for invalid input", () => {
        const result = formatTimelineStamp("invalid")
        expect(typeof result).toBe("string")
        expect(result.length).toBe(8)
    })

    test("resolvePlayerLabel and formatPlayerName prefer tag/username", () => {
        const player = { tag: "Tag#0001", username: "user", name: "Name" }
        expect(resolvePlayerLabel(player)).toBe("Tag#0001")
        expect(formatPlayerName(player)).toBe("**Tag#0001**")
    })
})
