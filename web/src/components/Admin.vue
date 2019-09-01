<template>
    <div id="app">
        <h2 v-if="client">Current status: {{ client.enabled ? "enabled" : "disabled"}}</h2>
        <button v-on:click="turnOff">Turn off</button>
        <button v-on:click="turnOn">Turn on</button>
    </div>
</template>

<script>
import axios from 'axios'

export default {
    name: "Admin",
    data() {
        return {
            client: null
        }
    },
    methods: {
        turnOff: function () {
            axios.get("http://localhost:3000/api/turnoff", {
                headers: {
                    token: this.$cookies.get("_token")
                }
            }).then((response) => {
                if (response.status == 200 && this.client) {
                    this.client.enabled = false
                }
            }).catch((error) => {
                console.error(error)
            })
        },
        turnOn: function () {
            axios.get("http://localhost:3000/api/turnon", {
                headers: {
                    token: this.$cookies.get("_token")
                }
            }).then((response) => {
                if (response.status == 200 && this.client) {
                    this.client.enabled = true
                }
            }).catch((error) => {
                console.error(error)
            })
        }
    },
    async created() {
        if (this.$root.user.token) {
            await this.$root.getUser(this.$root.user.token).then((data) => {
                this.$root.user.info = data;
            })
        }
        if (!this.$root.user.info || !this.$root.user.info.isAdmin) 
            return this.$router.push("/")
        this.$root.getClient(this.$cookies.get("_token")).then((client) => {
            this.client = client;
        })
    }
}
</script>

<style>

</style>
