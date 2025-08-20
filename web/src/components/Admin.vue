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
            client: null,
            csrfToken: null
        }
    },
    methods: {
        turnOff: function () {
            if (!this.csrfToken) {
                return console.error("Missing CSRF token, aborting request")
            }
            axios.post("http://localhost:3000/api/turnoff", null, {
                headers: {
                    token: this.$cookies.get("_token"),
                    "x-csrf-token": this.csrfToken
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
            if (!this.csrfToken) {
                return console.error("Missing CSRF token, aborting request")
            }
            axios.post("http://localhost:3000/api/turnon", null, {
                headers: {
                    token: this.$cookies.get("_token"),
                    "x-csrf-token": this.csrfToken
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
            const { csrfToken, ...rest } = client
            this.client = rest;
            this.csrfToken = csrfToken;
        })
    }
}
</script>

<style>

</style>
