<template>
    
</template>

<script>
import { id } from "../../../config.json"
export default {
    created() {
        return location.href = `https://discordapp.com/api/oauth2/authorize?client_id=${id}&redirect_uri=http%3A%2F%2Flocalhost%3A8080&response_type=code&scope=identify%20guilds`
    }
}
</script>

<style>

</style>
