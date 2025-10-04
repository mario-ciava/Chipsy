const userDetailLayout = Object.freeze({
    overviewSections: [
        {
            id: "balances",
            title: "Balances",
            fields: [
                { key: "money", label: "Balance" },
                { key: "gold", label: "Gold" },
                { key: "biggestWon", label: "Biggest win" },
                { key: "biggestBet", label: "Biggest bet" }
            ]
        },
        {
            id: "progression",
            title: "Progression",
            fields: [
                { key: "level", label: "Level" },
                { key: "exp", label: "Exp" },
                { key: "winRate", label: "Win rate" },
                { key: "handsPlayed", label: "Hands played" },
                { key: "handsWon", label: "Hands won" },
                { key: "lastPlayed", label: "Last activity" }
            ]
        },
        {
            id: "panel-access",
            title: "Panel access",
            fields: [
                { key: "role", label: "Role" },
                { key: "whitelist", label: "Whitelist" },
                { key: "blacklist", label: "Blacklist" },
                { key: "updatedAccess", label: "Last update", fallback: "Not available" }
            ]
        }
    ]
})

module.exports = userDetailLayout
