<template>
    <div class="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-3xl border border-white/10 bg-slate-900/70 p-8 text-center shadow-chip-card">
        <h1 class="text-2xl font-semibold text-white">Logging out…</h1>
        <p class="text-sm text-slate-300">You&apos;ll be redirected to the home page in a moment.</p>
    </div>
</template>

<script>
export default {
    name: "LogoutPage",
    async created() {
        await this.$store.dispatch("session/logout")
        this.$router.replace({ name: "Home" })
    }
}
</script>
