<template>
    <div class="chip-shell">
        <header class="chip-shell__nav">
            <router-link to="/" class="chip-shell__brand">
                <div class="flex items-center gap-3">
                    <div class="chip-brand-avatar">
                        <img
                            v-if="brandAvatarUrl"
                            :src="brandAvatarUrl"
                            :alt="`${brandInitial} avatar`"
                            class="chip-brand-avatar__image"
                        />
                        <span v-else class="chip-brand-avatar__initial">{{ brandInitial }}</span>
                    </div>
                    <div class="flex flex-col leading-tight">
                        <span class="text-2xl font-semibold text-white">Chipsy</span>
                        <span class="chip-label text-[0.58rem] tracking-[0.25em]">Control Center</span>
                    </div>
                </div>
            </router-link>
            <nav class="chip-shell__menu" aria-label="Main navigation">
                <router-link exact to="/" class="chip-nav__link">Home</router-link>
                <router-link v-if="isAdmin" to="/control_panel" class="chip-nav__link">Panel</router-link>
                <router-link v-if="canViewLogs" to="/logs" class="chip-nav__link">Logs</router-link>
                <router-link v-if="canViewLogs" to="/tables" class="chip-nav__link">Tables</router-link>
            </nav>
            <div class="chip-shell__actions">
                <span v-if="isAuthenticated" class="text-sm">
                    Welcome <span class="font-semibold text-white">{{ userName }}</span>
                </span>
                <button
                    v-if="!isAuthenticated"
                    type="button"
                    class="chip-btn chip-btn-primary text-sm"
                    @click="handleNavLogin"
                    :disabled="navLoginRedirecting"
                >
                    <span v-if="navLoginRedirecting">Redirecting…</span>
                    <span v-else>Sign in with Discord</span>
                </button>
                <router-link
                    v-else
                    to="/logout"
                    class="chip-btn chip-btn-secondary text-sm"
                >
                    Logout
                </router-link>
            </div>
        </header>

        <main class="chip-section flex-1">
            <router-view v-slot="{ Component, route }">
                <transition :name="route.meta.transition || 'fade'" mode="out-in">
                    <component :is="Component" :key="route.path" />
                </transition>
            </router-view>
        </main>

        <footer class="chip-footer">
            © 2025 Mario Ciavarella
        </footer>

        <transition name="toast-fade">
            <div v-if="toast.visible" class="chip-toast animate-chip-toast">
                {{ toast.message }}
            </div>
        </transition>
    </div>
</template>

<script>
import { mapGetters } from "vuex"
import ChipsyAvatar from "./assets/img/chipsy.png"

const DEFAULT_BRAND_INITIAL = "C"
const DEFAULT_BRAND_AVATAR = ChipsyAvatar

export default {
    name: "App",
    data() {
        return {
            toast: {
                message: "",
                visible: false,
                timeoutId: null
            },
            navLoginRedirecting: false
        }
    },
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user", "canViewLogs", "panelConfig"]),
        userName() {
            return this.user && this.user.username ? this.user.username : ""
        },
        brandInitial() {
            const name = this.panelConfig?.branding?.name || "Chipsy"
            const initial = name?.trim?.()?.charAt(0)
            return initial ? initial.toUpperCase() : DEFAULT_BRAND_INITIAL
        },
        brandAvatarUrl() {
            const configUrl = this.panelConfig?.branding?.avatarUrl
            const envUrl = process.env.VUE_APP_BRAND_AVATAR_URL
            return configUrl || envUrl || DEFAULT_BRAND_AVATAR
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
        handleNavLogin() {
            if (this.navLoginRedirecting) return
            this.navLoginRedirecting = true
            this.$router
                .push({ name: "Login" })
                .catch(() => null)
                .finally(() => {
                    this.navLoginRedirecting = false
                })
        },
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
