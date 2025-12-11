<template>
    <section class="space-y-6">
        <article
            class="chip-card chip-stack bg-gradient-to-br from-violet-600/20 via-slate-900/80 to-indigo-900/40 text-center lg:text-left"
        >
            <header class="chip-card__header grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div class="chip-stack text-left">
                    <span class="chip-eyebrow">
                        {{ whyChipsyContent.eyebrow || whyChipsyContent.tagline || "WHY CHIPSY" }}
                    </span>
                    <h3 class="chip-card__title">{{ whyChipsyContent.headline || "Why Chipsy" }}</h3>
                    <p class="chip-card__subtitle chip-card__subtitle--tight">
                        {{ whyChipsyContent.body || "Chipsy keeps Discord-native casinos synchronized across bot, panel and data." }}
                    </p>
                </div>
                <div v-if="guildInviteUrl" class="flex items-start justify-center lg:justify-end">
                    <a
                        class="chip-btn chip-btn-secondary chip-btn-fixed whitespace-nowrap"
                        :href="guildInviteUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open the Chipsy Discord invite"
                    >
                        <svg
                            class="h-6 w-6"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                d="M20.22 4.78a17.7 17.7 0 0 0-4.28-1.33l-.2.4a16.6 16.6 0 0 1 4 1.42 17.92 17.92 0 0 0-11.5 0 16.7 16.7 0 0 1 4-1.43l-.2-.4a17.68 17.68 0 0 0-4.28 1.34 19 19 0 0 0-3.45 13.8 15.9 15.9 0 0 0 4.16 2.08l.52-.8a11 11 0 0 1-1.73-.74l.22-.1c.14.1.4.24.4.24a12.7 12.7 0 0 0 10.3 0s.25-.14.4-.24l.21.1a11.2 11.2 0 0 1-1.72.74l.51.8a15.9 15.9 0 0 0 4.16-2.08 19 19 0 0 0-3.42-13.8ZM10 15.15c-.8 0-1.44-.73-1.44-1.62s.64-1.62 1.43-1.62 1.44.73 1.44 1.62-.64 1.62-1.43 1.62Zm4 0c-.8 0-1.44-.73-1.44-1.62s.65-1.62 1.44-1.62 1.44.73 1.44 1.62-.65 1.62-1.44 1.62Z"
                            />
                        </svg>
                        <span>Join Chipsy</span>
                    </a>
                </div>
            </header>
            <div class="chip-divider chip-divider--strong my-2"></div>
            <div v-if="whyChipsyPillars.length" class="grid gap-4 lg:grid-cols-3">
                <section
                    v-for="pillar in whyChipsyPillars"
                    :key="pillar.title"
                    class="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                    <div class="flex items-center gap-2 text-white">
                        <span class="text-xl">{{ pillar.icon }}</span>
                        <p class="text-base font-semibold">{{ pillar.title }}</p>
                    </div>
                    <p class="text-sm text-slate-300">{{ pillar.copy }}</p>
                    <ul class="space-y-1 pl-5 text-sm text-slate-300">
                        <li
                            v-for="bullet in pillar.bullets"
                            :key="bullet"
                            class="list-disc marker:text-violet-400"
                        >
                            {{ bullet }}
                        </li>
                    </ul>
                </section>
            </div>
            <p v-else class="text-sm text-slate-400">
                Pillars coming soon. Configure differentiators in the marketing content to highlight value props.
            </p>
            <div class="chip-divider chip-divider--strong my-2"></div>
            <div v-if="whyChipsyBadges.length" class="flex flex-wrap gap-2">
                <span
                    v-for="badge in whyChipsyBadges"
                    :key="badge.label"
                    class="chip-pill chip-pill-ghost flex flex-wrap items-center gap-2"
                >
                    <span class="text-sm font-semibold text-white normal-case">{{ badge.label }}</span>
                    <span class="text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-slate-300">
                        {{ badge.detail }}
                    </span>
                </span>
            </div>
            <p v-else class="text-sm text-slate-400">
                Brand badges will appear automatically once the marketing config lists them.
            </p>
        </article>

        <div class="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <article class="chip-card chip-stack">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">
                            {{ launchPlaybook.eyebrow || launchPlaybook.tagline || "LAUNCH PLAYBOOK" }}
                        </span>
                        <h3 class="chip-card__title">{{ launchPlaybook.title || "Launch playbook" }}</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            {{ launchPlaybook.subtitle || "Borrow our onboarding steps to bring Chipsy live." }}
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong my-2"></div>
                <ol class="chip-stack">
                    <li
                        v-for="(step, index) in launchSteps"
                        :key="step.title"
                        class="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                        <span class="chip-pill-metric inline-flex h-10 w-10 flex-shrink-0 items-center justify-center p-0 text-base">
                            {{ index + 1 }}
                        </span>
                        <div class="chip-stack text-left">
                            <p class="text-base font-semibold text-white">{{ step.title }}</p>
                            <p class="text-sm text-slate-300">{{ step.detail }}</p>
                        </div>
                    </li>
                </ol>
            </article>

            <article class="chip-card chip-stack">
                <header class="chip-card__header">
                    <div class="chip-stack">
                        <span class="chip-eyebrow">
                            {{ readinessContent.eyebrow || readinessContent.tagline || "OPERATIONAL READINESS" }}
                        </span>
                        <h3 class="chip-card__title">{{ readinessContent.title || "Operational readiness" }}</h3>
                        <p class="chip-card__subtitle chip-card__subtitle--tight">
                            {{ readinessContent.subtitle || "Preview the guardrails that keep guilds healthy." }}
                        </p>
                    </div>
                </header>
                <div class="chip-divider chip-divider--strong my-2"></div>
                <div class="grid gap-3 sm:grid-cols-2">
                    <div
                        v-for="stat in readinessStats"
                        :key="stat.label"
                        class="chip-stat chip-stat--inline"
                    >
                        <span class="chip-stat__label">{{ stat.label }}</span>
                        <span class="chip-stat__value">{{ stat.value }}</span>
                        <p class="text-xs text-slate-400">{{ stat.detail }}</p>
                    </div>
                </div>
                <div class="chip-divider chip-divider--strong my-1"></div>
                <ul class="chip-stack divide-y divide-white/5">
                    <li
                        v-for="assurance in readinessAssurances"
                        :key="assurance.tag"
                        class="grid gap-3 pt-3 first:pt-0 sm:grid-cols-[160px_1fr] sm:items-center"
                    >
                        <div class="flex justify-center">
                            <span class="chip-pill chip-pill-info flex h-9 w-40 items-center justify-center text-center text-[0.7rem] tracking-[0.2em] px-2 border border-white/20">
                                {{ assurance.tag }}
                            </span>
                        </div>
                        <p class="text-sm text-slate-300">
                            {{ assurance.detail }}
                        </p>
                    </li>
                </ul>
            </article>
        </div>
    </section>
</template>

<script>
export default {
    name: "HomeMarketingSection",
    props: {
        whyChipsyContent: {
            type: Object,
            default: () => ({})
        },
        whyChipsyPillars: {
            type: Array,
            default: () => []
        },
        whyChipsyBadges: {
            type: Array,
            default: () => []
        },
        launchPlaybook: {
            type: Object,
            default: () => ({})
        },
        launchSteps: {
            type: Array,
            default: () => []
        },
        readinessContent: {
            type: Object,
            default: () => ({})
        },
        readinessStats: {
            type: Array,
            default: () => []
        },
        readinessAssurances: {
            type: Array,
            default: () => []
        },
        guildInviteUrl: {
            type: String,
            default: ""
        }
    }
}
</script>
