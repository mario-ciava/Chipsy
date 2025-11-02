const createScoreTexture = (sheen, grain) => [
    `linear-gradient(125deg, ${sheen} 0%, rgba(255, 255, 255, 0) 70%)`,
    "radial-gradient(circle at 90% -15%, rgba(255, 255, 255, 0.35), transparent 60%)",
    `repeating-linear-gradient(145deg, ${grain} 0, ${grain} 1px, transparent 1px, transparent 3px)`
].join(", ")

export const defaultRingColor = "rgba(148, 163, 184, 0.35)"
export const defaultAccentOverlay = "rgba(99, 102, 241, 0.25)"
export const defaultCardGradient = "linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.85))"
export const defaultScoreGradient = "linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(148, 163, 184, 0.08))"
export const defaultScoreTexture = "repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0, rgba(255, 255, 255, 0.05) 1px, transparent 1px, transparent 4px)"

export const podiumFinishStyles = Object.freeze({
    1: {
        ring: "rgba(253, 224, 71, 0.75)",
        accent: "#fcd34d",
        cardGradient: "linear-gradient(135deg, rgba(253, 224, 71, 0.32) 0%, rgba(180, 83, 9, 0.15) 100%)",
        gradient: "linear-gradient(135deg, rgba(255, 250, 214, 0.95) 0%, rgba(253, 224, 71, 0.92) 45%, rgba(180, 83, 9, 0.88) 100%)",
        texture: createScoreTexture("rgba(255, 255, 255, 0.45)", "rgba(255, 255, 255, 0.28)"),
        scoreBorder: "rgba(253, 230, 138, 0.8)",
        rankGradient: "linear-gradient(135deg, rgba(255, 250, 214, 0.95) 0%, rgba(253, 224, 71, 0.9) 50%, rgba(180, 83, 9, 0.85) 100%)"
    },
    2: {
        ring: "rgba(226, 232, 240, 0.75)",
        accent: "#cbd5f5",
        cardGradient: "linear-gradient(135deg, rgba(226, 232, 240, 0.35) 0%, rgba(148, 163, 184, 0.18) 100%)",
        gradient: "linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(209, 213, 219, 0.9) 50%, rgba(100, 116, 139, 0.92) 100%)",
        texture: createScoreTexture("rgba(255, 255, 255, 0.4)", "rgba(255, 255, 255, 0.22)"),
        scoreBorder: "rgba(226, 232, 240, 0.75)",
        rankGradient: "linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(209, 213, 219, 0.9) 55%, rgba(100, 116, 139, 0.92) 100%)"
    },
    3: {
        ring: "rgba(248, 196, 133, 0.8)",
        accent: "#f59e0b",
        cardGradient: "linear-gradient(135deg, rgba(251, 191, 133, 0.3) 0%, rgba(120, 53, 15, 0.18) 100%)",
        gradient: "linear-gradient(135deg, rgba(255, 240, 219, 0.92) 0%, rgba(244, 161, 94, 0.9) 45%, rgba(120, 53, 15, 0.85) 100%)",
        texture: createScoreTexture("rgba(255, 255, 255, 0.35)", "rgba(255, 255, 255, 0.18)"),
        scoreBorder: "rgba(251, 191, 133, 0.75)",
        rankGradient: "linear-gradient(135deg, rgba(255, 235, 205, 0.95) 0%, rgba(244, 161, 94, 0.9) 45%, rgba(120, 53, 15, 0.85) 100%)"
    }
})

export const getPodiumFinish = (rank) => {
    if (typeof rank !== "number") {
        return null
    }
    return podiumFinishStyles[rank] || null
}
