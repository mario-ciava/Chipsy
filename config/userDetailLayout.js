const userDetailLayout = Object.freeze({
    overviewSections: [
        {
            id: "profile-core",
            title: "Profile core",
            fields: [
                { key: "money", label: "Balance", hint: "Spendable chips", toneClass: "chip-status__value--primary" },
                { key: "gold", label: "Gold", hint: "Premium currency", toneClass: "chip-status__value--accent" },
                { key: "level", label: "Level", hint: "Tier progress", toneClass: "chip-status__value--info" },
                { key: "lastPlayed", label: "Last activity", hint: "Reward timeline" }
            ]
        },
        {
            id: "profile-extra",
            title: "Performance",
            fields: [
                { key: "handsPlayed", label: "Hands played", hint: "Lifetime rounds" },
                { key: "handsWon", label: "Hands won", hint: "Across all games" },
                { key: "biggestBet", label: "Biggest bet", hint: "Single wager" },
                { key: "biggestWon", label: "Biggest win", hint: "Largest payout" },
                { key: "winRate", label: "Win rate", hint: "Win percentage" },
                { key: "exp", label: "Exp", hint: "Progress to next tier" }
            ]
        }
    ]
})

module.exports = userDetailLayout
