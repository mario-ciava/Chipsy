<template>
    <div class="page page--centered">
        <header class="page__header">
            <h1 class="page__title">Uscita</h1>
            <p class="page__subtitle">Stai per essere reindirizzato alla home.</p>
        </header>
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
