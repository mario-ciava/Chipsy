const uiTheme = Object.freeze({
    colors: {
        background: "#050816",
        backdrop: "radial-gradient(circle at 25% 10%, rgba(99, 102, 241, 0.28), transparent 55%), linear-gradient(135deg, #0f172a 0%, #111827 40%, #10162a 100%)",
        surface: "rgba(15, 23, 42, 0.78)",
        emphasisSurface: "rgba(15, 23, 42, 0.92)",
        cardBorder: "rgba(148, 163, 184, 0.25)",
        primary: "#f8fafc",
        secondary: "#e0e7ff",
        muted: "#94a3b8",
        accent: "#7c3aed",
        accentSoft: "rgba(124, 58, 237, 0.18)",
        highlight: "#6366f1",
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171"
    },
    fonts: {
        sans: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        mono: '"JetBrains Mono", "Fira Code", monospace'
    },
    layout: {
        shellMaxWidth: 1120,
        contentMaxWidth: 720,
        navHeight: 72,
        cardGap: 24
    },
    radii: {
        xl: "24px",
        lg: "18px",
        md: "14px",
        sm: "10px",
        pill: "999px"
    },
    effects: {
        cardShadow: "0 40px 80px -24px rgba(15, 23, 42, 0.65)",
        softShadow: "0 20px 40px -24px rgba(15, 23, 42, 0.45)"
    }
})

module.exports = uiTheme
