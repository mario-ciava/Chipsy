<template>
    <div id="app">
        <div v-if="servers && !inviting && !set">
            <h2>Select server</h2>
            <select v-model="selected">
                <option v-for="(guild, index) in servers" v-bind:key="guild.id" v-bind:value="guild.id">
                    {{ index + 1 }} - {{ guild.name }}
                </option>
            </select>
            <button v-on:click="setServer()">Select</button>
        </div>
        <div v-else-if="set">
            <h2>Server name: {{ selected.name }}</h2>
            <br>
            <h2>Server owner: {{ selected.owner }}</h2>
        </div>
    </div>
</template>

<script>
import axios from 'axios'

export default {
    name: "Panel",
    data() {
        return {
            servers: null,
            selected: null,
            inviting: false,
            set: false
        }
    },
    methods: {
        async setServer() {
            if (!this.selected) return
            console.log(this.selected)
            await this.$root.getGuilds(this.$root.user.token).then(async(data) => {
                let guild = await data.added.find((g) => {
                    return g.id == this.selected
                })
                if (!guild) {
                    this.inviting = true
                    return location.href = "https://discordapp.com/api/oauth2/authorize?client_id=605321090708930626&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcontrol_panel&scope=bot"
                } else {
                    this.selected = guild
                    this.set = true
                }
            })
        }
    },
    async created() {
        if (this.$root.user.token) {
            await this.$root.getUser(this.$root.user.token).then((data) => {
                this.$root.user.info = data;
            })
            await this.$root.getGuilds(this.$root.user.token).then((data) => {
                this.servers = data.available;
            })
            if (this.inviting) {
                await this.setServer()
                this.inviting = false
            }
        } else {
            return this.$router.push("/");
        }
    }
}
</script>

<style>
</style>
