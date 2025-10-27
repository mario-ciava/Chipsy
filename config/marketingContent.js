const marketingContent = Object.freeze({
    home: {
        whyChipsy: {
            tagline: "CHIPSY BOT COMPANION",
            eyebrow: "Chipsy bot companion",
            headline: "Why Chipsy",
            body: "Chipsy is a Discord casino bot shaped for small, close communities. We prioritize honest chip flows, readable dashboards, and a roadmap influenced directly by the few guilds that lean on us each week.",
            pillars: [
                {
                    icon: "🧠",
                    title: "Aligned chip play",
                    copy: "Balances, perks, and cooldowns stay mirrored between the bot and the lightweight control center so players never feel a mismatch.",
                    bullets: [
                        "One wallet shared by bot + dashboard",
                        "Nightly sync with transparent JSON exports"
                    ]
                },
                {
                    icon: "⚡",
                    title: "Steady operations",
                    copy: "Owners can pause tables, restart quests, or gift chips without digging into scripts—everything sits behind two clicks.",
                    bullets: [
                        "Inline confirmations for every action",
                        "Roles map directly to Discord permissions"
                    ]
                },
                {
                    icon: "📊",
                    title: "Practical insights",
                    copy: "Simple stats highlight streaks, losses, and cooldown abuse so you know where to tweak the experience next.",
                    bullets: [
                        "Cross-game counters with context",
                        "Audit notes on every payout change"
                    ]
                }
            ],
            badges: [
                { label: "Small server ready", detail: "tuned for dozens of members" },
                { label: "Structured logging", detail: "plain JSON you can self-host" },
                { label: "Shared design tokens", detail: "same look inside embeds and panel" }
            ]
        },
        playbook: {
            tagline: "LAUNCH PLAYBOOK",
            eyebrow: "Launch playbook",
            title: "From invite to friendly bankroll",
            subtitle: "Follow the step-by-step routine we actually run when onboarding a partner guild.",
            steps: [
                {
                    title: "Provision the guild",
                    detail: "Send the scoped OAuth link, confirm intents together, and save the guild metadata directly from Discord."
                },
                {
                    title: "Calibrate the bankroll",
                    detail: "Mirror chip totals, tax rules, and upgrade caps so the bot and database start in sync."
                },
                {
                    title: "Enable engagement loops",
                    detail: "Turn on dailies, quests, and drops using presets already filled with conservative defaults."
                },
                {
                    title: "Review live signals",
                    detail: "Health pings, fraud flags, and KPI deltas land in the hero header so you can keep tabs without extra dashboards."
                }
            ]
        },
        readiness: {
            tagline: "OPERATIONAL READINESS",
            eyebrow: "Operational readiness",
            title: "Signals before logging in",
            subtitle: "Figures live inside config so marketing, docs, and the control panel tell the same grounded story.",
            stats: [
                { label: "Guilds synced", value: "12 servers", detail: "actively co-building features" },
                { label: "Avg. launch window", value: "~10 min", detail: "manual review included" },
                { label: "Automation coverage", value: "70%", detail: "remaining flows handled via DM support" },
                { label: "Crash rollback", value: "Manual snapshots", detail: "restores driven by nightly exports" }
            ],
            assurances: [
                { tag: "Failover", detail: "Backup shards stay in-region so handoffs remain quick even on limited scale." },
                { tag: "Auditability", detail: "Every payout, freeze, or upgrade keeps metadata in MySQL for later review." },
                { tag: "Design harmony", detail: "Shared UI tokens keep the experience coherent in the panel and in embeds." }
            ]
        }
    }
})

module.exports = marketingContent
