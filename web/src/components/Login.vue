<template>
    
</template>

<script>
export default {
    created() {
        const clientId = process.env.VUE_APP_DISCORD_CLIENT_ID
        if (!clientId) {
            console.error("Missing VUE_APP_DISCORD_CLIENT_ID environment variable.")
            return
        }
        location.href = `https://discordapp.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=http%3A%2F%2Flocalhost%3A8080&response_type=code&scope=identify%20guilds`
    }
}
</script>

<style>

</style>
