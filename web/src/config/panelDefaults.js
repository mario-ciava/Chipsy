export const PANEL_DEFAULTS = Object.freeze({
    http: {
        timeoutMs: 15000
    },
    toggles: {
        cooldownMs: 15000,
        holdDurationMs: 3000
    },
    status: {
        refreshIntervalMs: 30000
    },
    guilds: {
        waitForJoin: {
            pollDelayMs: 1500,
            maxAttemptsWithTarget: 5,
            maxAttemptsWithoutTarget: 3
        },
        fetch: {
            cacheTtlMs: 5000,
            maxEntries: 250,
            retryAfterFloorMs: 7000
        }
    },
    dropdown: {
        background: "rgba(15, 23, 42, 0.95)",
        border: "rgba(148, 163, 184, 0.35)",
        optionHover: "rgba(99, 102, 241, 0.35)",
        optionActive: "rgba(124, 58, 237, 0.45)",
        optionText: "#f8fafc"
    },
    userStats: {
        densityModes: [
            { label: "Comfort", value: "comfortable" },
            { label: "Compact", value: "compact" }
        ],
        kpis: {
            maxCards: 5,
            veteranLevelThreshold: 40,
            vipBalanceThreshold: 250000,
            recentActivityWindowDays: 14
        }
    }
})

const sanitizeDensityModes = (modes = []) => {
    if (!Array.isArray(modes)) {
        return PANEL_DEFAULTS.userStats.densityModes
    }
    const cleaned = modes
        .map((mode) => {
            const label = typeof mode?.label === "string" ? mode.label.trim() : ""
            const value = typeof mode?.value === "string" ? mode.value.trim() : ""
            if (!label || !value) {
                return null
            }
            return { label, value }
        })
        .filter(Boolean)

    return cleaned.length ? cleaned : PANEL_DEFAULTS.userStats.densityModes
}

const toPositiveNumber = (value, fallback) => {
    const numeric = Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

export const getPanelConfig = (panel = {}) => ({
    http: {
        timeoutMs: Number(panel?.http?.timeoutMs) || PANEL_DEFAULTS.http.timeoutMs
    },
    toggles: {
        cooldownMs: Number(panel?.toggles?.cooldownMs) || PANEL_DEFAULTS.toggles.cooldownMs,
        holdDurationMs: Number(panel?.toggles?.holdDurationMs) || PANEL_DEFAULTS.toggles.holdDurationMs
    },
    status: {
        refreshIntervalMs: Number(panel?.status?.refreshIntervalMs) || PANEL_DEFAULTS.status.refreshIntervalMs
    },
    guilds: {
        waitForJoin: {
            pollDelayMs: Number(panel?.guilds?.waitForJoin?.pollDelayMs) || PANEL_DEFAULTS.guilds.waitForJoin.pollDelayMs,
            maxAttemptsWithTarget: Number(panel?.guilds?.waitForJoin?.maxAttemptsWithTarget)
                || PANEL_DEFAULTS.guilds.waitForJoin.maxAttemptsWithTarget,
            maxAttemptsWithoutTarget: Number(panel?.guilds?.waitForJoin?.maxAttemptsWithoutTarget)
                || PANEL_DEFAULTS.guilds.waitForJoin.maxAttemptsWithoutTarget
        },
        fetch: {
            cacheTtlMs: Number(panel?.guilds?.fetch?.cacheTtlMs) || PANEL_DEFAULTS.guilds.fetch.cacheTtlMs,
            maxEntries: Number(panel?.guilds?.fetch?.maxEntries) || PANEL_DEFAULTS.guilds.fetch.maxEntries,
            retryAfterFloorMs: Number(panel?.guilds?.fetch?.retryAfterFloorMs)
                || PANEL_DEFAULTS.guilds.fetch.retryAfterFloorMs
        }
    },
    dropdown: {
        background: panel?.dropdown?.background || PANEL_DEFAULTS.dropdown.background,
        border: panel?.dropdown?.border || PANEL_DEFAULTS.dropdown.border,
        optionHover: panel?.dropdown?.optionHover || PANEL_DEFAULTS.dropdown.optionHover,
        optionActive: panel?.dropdown?.optionActive || PANEL_DEFAULTS.dropdown.optionActive,
        optionText: panel?.dropdown?.optionText || PANEL_DEFAULTS.dropdown.optionText
    },
    userStats: {
        densityModes: sanitizeDensityModes(panel?.userStats?.densityModes),
        kpis: {
            maxCards: toPositiveNumber(panel?.userStats?.kpis?.maxCards, PANEL_DEFAULTS.userStats.kpis.maxCards),
            veteranLevelThreshold: toPositiveNumber(
                panel?.userStats?.kpis?.veteranLevelThreshold,
                PANEL_DEFAULTS.userStats.kpis.veteranLevelThreshold
            ),
            vipBalanceThreshold: toPositiveNumber(
                panel?.userStats?.kpis?.vipBalanceThreshold,
                PANEL_DEFAULTS.userStats.kpis.vipBalanceThreshold
            ),
            recentActivityWindowDays: toPositiveNumber(
                panel?.userStats?.kpis?.recentActivityWindowDays,
                PANEL_DEFAULTS.userStats.kpis.recentActivityWindowDays
            )
        }
    }
})
