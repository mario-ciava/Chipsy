<template>
    <div class="chip-shell">
        <header class="chip-shell__nav">
            <router-link to="/" class="text-2xl font-semibold tracking-tight text-white">
                Chipsy
            </router-link>
            <nav class="flex flex-wrap items-center justify-center gap-2 text-sm font-semibold text-slate-300">
                <router-link exact to="/" class="chip-nav__link">Home</router-link>
                <router-link v-if="isAdmin" to="/control_panel" class="chip-nav__link">Panel</router-link>
                <router-link v-if="canViewLogs" to="/logs" class="chip-nav__link">Logs</router-link>
            </nav>
            <div class="flex flex-wrap items-center justify-center gap-3 text-sm text-slate-300">
                <span v-if="isAuthenticated">
                    Welcome <span class="font-semibold text-white">{{ userName }}</span>
                </span>
                <router-link
                    v-if="!isAuthenticated"
                    to="/login"
                    class="chip-btn chip-btn-ghost text-sm"
                >
                    Login
                </router-link>
                <router-link
                    v-else
                    to="/logout"
                    class="chip-btn chip-btn-secondary text-sm"
                >
                    Logout
                </router-link>
            </div>
        </header>

        <main class="mx-auto flex w-full max-w-shell flex-1 flex-col gap-6">
            <router-view v-slot="{ Component, route }">
                <transition :name="route.meta.transition || 'fade'" mode="out-in">
                    <component :is="Component" :key="route.path" />
                </transition>
            </router-view>
        </main>

        <transition name="toast-fade">
            <div v-if="toast.visible" class="chip-toast animate-chip-toast">
                {{ toast.message }}
            </div>
        </transition>
    </div>
</template>

<script>
import { mapGetters } from "vuex"

export default {
    name: "App",
    data() {
        return {
            toast: {
                message: "",
                visible: false,
                timeoutId: null
            }
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user", "canViewLogs"]),
        userName() {
            return this.user && this.user.username ? this.user.username : ""
        }
    },
    mounted() {
        window.addEventListener("session-expired", this.handleSessionExpired)
        window.addEventListener("chipsy-toast", this.handleToastEvent)
    },
    beforeDestroy() {
        window.removeEventListener("session-expired", this.handleSessionExpired)
        window.removeEventListener("chipsy-toast", this.handleToastEvent)
        if (this.toast.timeoutId) {
            clearTimeout(this.toast.timeoutId)
            this.toast.timeoutId = null
        }
    },
    methods: {
        handleSessionExpired() {
            this.$store.dispatch("session/clear").catch(() => null)

            const currentRoute = this.$route.path
            if (currentRoute !== "/login" && currentRoute !== "/") {
                this.$router.push({
                    name: "Login",
                    query: { expired: "true", redirect: currentRoute }
                })
            }
        },
        handleToastEvent(event) {
            const message = event?.detail?.message
            if (!message) return
            if (this.toast.timeoutId) {
                clearTimeout(this.toast.timeoutId)
                this.toast.timeoutId = null
            }
            this.toast.message = message
            this.toast.visible = true
            this.toast.timeoutId = setTimeout(() => {
                this.toast.visible = false
                this.toast.timeoutId = null
            }, 2200)
        }
    }
}
</script>
