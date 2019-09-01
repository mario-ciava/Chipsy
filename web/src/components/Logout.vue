<template>
</template>

<script>
import axios from 'axios'

export default {
    async created() {
        if (this.$root.user.token) {
            await this.$root.getUser(this.$root.user.token).then((data) => {
                axios.post("http://localhost:3000/api/logout", {
                    user: data
                })
            }).catch((error) => {
               console.error(error)
            }).finally(() => {
                this.$cookies.remove("_token")
                this.$root.user.token = null
            })
        }
        this.$router.push("/")
    }
}
</script>

<style>

</style>
