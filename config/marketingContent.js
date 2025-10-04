const marketingContent = Object.freeze({
    home: {
        whyChipsy: {
            tagline: "CHIPSY CONTROL CENTER",
            eyebrow: "Chipsy Control Center",
            headline: "Why Chipsy",
            body: "All-in-one casino automation for Discord. Chipsy aligns the bot, panel, and data stack so ops teams can run casino-grade economies without rebuilding the same workflows for every guild.",
            pillars: [
                {
                    icon: "🧠",
                    title: "Unified economies",
                    copy: "Keep bankrolls, upgrade paths, and treasury rules mirrored between Discord and the control center.",
                    bullets: [
                        "Shared ledger across bot + panel",
                        "Automatic sync with MySQL snapshots"
                    ]
                },
                {
                    icon: "⚡",
                    title: "Operator velocity",
                    copy: "Dispatch invites, freeze tables, or review risk events directly from the shell—no CLI hop required.",
                    bullets: [
                        "Inline guardrails on every action",
                        "Role-aware shortcuts for staff tiers"
                    ]
                },
                {
                    icon: "📊",
                    title: "Signal-rich insights",
                    copy: "Surface player KPIs, retention clues, and fraud sentiment in one place so teams can tune campaigns in real time.",
                    bullets: [
                        "Cross-game stats with context",
                        "Audit trails for every adjustment"
                    ]
                }
            ],
            badges: [
                { label: "60s setup", detail: "bot + panel bootstrapped together" },
                { label: "SOC friendly defaults", detail: "structured logging and scoped secrets" },
                { label: "Shared design tokens", detail: "UI parity between dashboard and bot embeds" }
            ]
        },
        playbook: {
            tagline: "LAUNCH PLAYBOOK",
            eyebrow: "Launch Playbook",
            title: "From invite to live bankroll",
            subtitle: "Borrow the same onboarding flow we use when lighting up Chipsy for new operators.",
            steps: [
                {
                    title: "Provision the guild",
                    detail: "Generate a scoped OAuth link, confirm Discord intents, and pre-fill the control panel with guild metadata."
                },
                {
                    title: "Calibrate the bankroll",
                    detail: "Mirror treasury totals, tax rules, and upgrade caps so the bot and the database never drift."
                },
                {
                    title: "Enable engagement loops",
                    detail: "Launch dailies, quests, and scheduled drops with the chip-stack presets bundled in the panel."
                },
                {
                    title: "Review live signals",
                    detail: "Ops receives health alerts, fraud sentiment, and KPI deltas directly inside the hero header."
                }
            ]
        },
        readiness: {
            tagline: "OPERATIONAL READINESS",
            eyebrow: "Operational readiness",
            title: "Health signals before logging in",
            subtitle: "Static figures stay in config so marketing, docs, and the control panel narrate the same story.",
            stats: [
                { label: "Guilds synced", value: "1.2K+", detail: "health-checked every hour" },
                { label: "Avg. launch window", value: "< 6 min", detail: "from invite to first wager" },
                { label: "Automation coverage", value: "87%", detail: "journeys without manual ops" },
                { label: "Crash rollback", value: "90s", detail: "to restore bankroll snapshots" }
            ],
            assurances: [
                { tag: "Failover", detail: "Geo-distributed shards hand off automatically whenever Discord hiccups." },
                { tag: "Auditability", detail: "Every payout, freeze, or upgrade carries metadata back into MySQL for finance review." },
                { tag: "Design harmony", detail: "UI tokens are shared with embeds so the experience feels native across platforms." }
            ]
        }
    }
})

module.exports = marketingContent
