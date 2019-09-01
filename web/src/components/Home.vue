<template>
    <h2 v-if="!this.$root.user.token">Click login to login with discord!</h2>
    <h2 v-else-if="this.$root.user.info">Welcome back, {{ this.$root.user.info.username }}#{{ this.$root.user.info.discriminator }}</h2>
</template>

<script>
export default {
    name: "Home",
    async created() {
        if (this.$root.user.token) {
            await this.$root.getUser(this.$root.user.token).then((data) => {
                this.$root.user.info = data;
            })
        } else if (this.$route.query) {
            if (this.$route.query.code) {
                console.log("here")
                await this.$root.getAccessData(this.$route.query.code).then(async(data) => {
                    console.log("HELLOO")
                    this.$cookies.set("_token", data.access_token);
                    this.$root.user.token = this.$cookies.get("_token"); //Needed to update view
                    await this.$root.getUser(this.$root.user.token).then((data) => {
                        this.$root.user.info = data;
                    })
                })
            }
            this.$router.push("/")
        }
        if (this.$root.user.info) Object.freeze(this.$root.user.info);
    }
}
</script>

<style>

</style>
