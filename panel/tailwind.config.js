const ensureEnv = (key, fallback) => {
    if (!process.env[key] && fallback !== undefined) {
        process.env[key] = fallback
    }
}

const requiredEnvDefaults = {
    DISCORD_CLIENT_ID: "ui-theme",
    DISCORD_CLIENT_SECRET: "ui-theme",
    DISCORD_BOT_TOKEN: "ui-theme",
    DISCORD_OWNER_ID: "ui-theme",
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "app_data"
}

for (const [key, value] of Object.entries(requiredEnvDefaults)) {
    ensureEnv(key, value)
}

const { designTokens, uiTheme: legacyTheme } = require("../config")
const uiTheme = legacyTheme || designTokens?.theme || designTokens

const buildRoleBadgeColors = (tokens = {}) => {
    const palette = {}
    const badgeMap = tokens.roleBadges || {}
    for (const [role, values] of Object.entries(badgeMap)) {
        if (!values) continue
        if (values.start) {
            palette[`${role}Start`] = values.start
        }
        if (values.end) {
            palette[`${role}End`] = values.end
        }
        if (values.text) {
            palette[`${role}Text`] = values.text
        }
    }
    return palette
}

const roleBadgeColors = buildRoleBadgeColors(designTokens)

const px = (value) => `${value}px`

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./public/index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}"
    ],
    theme: {
        extend: {
            colors: {
                chip: {
                    background: uiTheme.colors.background,
                    surface: uiTheme.colors.surface,
                    emphasis: uiTheme.colors.emphasisSurface,
                    border: uiTheme.colors.cardBorder,
                    primary: uiTheme.colors.primary,
                    secondary: uiTheme.colors.secondary,
                    muted: uiTheme.colors.muted,
                    accent: uiTheme.colors.accent,
                    accentSoft: uiTheme.colors.accentSoft,
                    highlight: uiTheme.colors.highlight,
                    success: uiTheme.colors.success,
                    warning: uiTheme.colors.warning,
                    danger: uiTheme.colors.danger
                },
                status: {
                    live: uiTheme.colors.statusLive || uiTheme.colors.success,
                    updating: uiTheme.colors.statusUpdating || uiTheme.colors.warning,
                    offline: uiTheme.colors.statusOffline || uiTheme.colors.danger
                },
                roleBadge: roleBadgeColors
            },
            fontFamily: {
                sans: [uiTheme.fonts.sans, "sans-serif"],
                mono: [uiTheme.fonts.mono, "monospace"]
            },
            maxWidth: {
                shell: px(uiTheme.layout.shellMaxWidth),
                content: px(uiTheme.layout.contentMaxWidth)
            },
            borderRadius: {
                "chip-xl": uiTheme.radii.xl,
                "chip-lg": uiTheme.radii.lg,
                "chip-md": uiTheme.radii.md,
                "chip-sm": uiTheme.radii.sm,
                "chip-pill": uiTheme.radii.pill
            },
            boxShadow: {
                "chip-card": uiTheme.effects.cardShadow,
                "chip-soft": uiTheme.effects.softShadow
            },
            backgroundImage: {
                "chip-shell": uiTheme.colors.backdrop
            },
            keyframes: {
                "chip-pulse": {
                    "0%, 100%": { opacity: "1" },
                    "50%": { opacity: "0.7" }
                },
                "chip-shimmer": {
                    "0%": { opacity: "0.45" },
                    "50%": { opacity: "0.9" },
                    "100%": { opacity: "0.45" }
                },
                "chip-toast": {
                    "0%": { transform: "translateY(100%) scale(0.96)", opacity: "0" },
                    "60%": { transform: "translateY(-4px) scale(1.01)", opacity: "1" },
                    "100%": { transform: "translateY(0) scale(1)", opacity: "1" }
                }
            },
            animation: {
                "chip-pulse": "chip-pulse 1.8s ease-in-out infinite",
                "chip-shimmer": "chip-shimmer 2.8s ease-in-out infinite",
                "chip-toast": "chip-toast 0.35s ease both"
            }
        }
    },
    plugins: [
        require("@tailwindcss/forms")({
            strategy: "class"
        })
    ]
}
