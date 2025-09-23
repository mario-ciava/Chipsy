<template>
    <div class="app-shell">
        <header class="app-shell__nav">
            <div class="nav__brand">
                <router-link to="/">Chipsy</router-link>
            </div>
            <nav class="nav__links">
                <router-link exact to="/">Home</router-link>
                <router-link v-if="isAdmin" to="/control_panel">Panel</router-link>
                <router-link v-if="canViewLogs" to="/logs">Logs</router-link>
            </nav>
            <div class="nav__auth">
                <span v-if="isAuthenticated" class="nav__welcome">
                    Welcome {{ userName }}
                </span>
                <router-link
                    v-if="!isAuthenticated"
                    to="/login"
                    class="button button--ghost"
                >
                    Login
                </router-link>
                <router-link
                    v-else
                    to="/logout"
                    class="button button--secondary"
                >
                    Logout
                </router-link>
            </div>
        </header>

        <main class="app-shell__content">
            <router-view v-slot="{ Component, route }">
                <transition :name="route.meta.transition || 'fade'" mode="out-in">
                    <component :is="Component" :key="route.path" />
                </transition>
            </router-view>
        </main>

        <transition name="toast-fade">
            <div v-if="toast.visible" class="app-toast">
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

<style scoped>
.app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
}

.app-shell__nav {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 24px;
    justify-items: center;
    padding: 16px 32px;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(24px);
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    position: sticky;
    top: 0;
    z-index: 10;
    text-align: center;
}

.nav__brand a {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f8fafc;
    text-decoration: none;
}

.nav__links {
    display: flex;
    justify-self: center;
    justify-content: center;
    gap: 16px;
    flex-wrap: wrap;
}

.nav__links a {
    color: #cbd5f5;
    text-decoration: none;
    font-weight: 500;
    padding: 8px 12px;
    border-radius: 8px;
    transition: background 0.2s ease;
}

.nav__links a.router-link-exact-active,
.nav__links a.router-link-active {
    background: rgba(99, 102, 241, 0.2);
    color: #f8fafc;
}

.nav__links a:hover {
    background: rgba(148, 163, 184, 0.2);
}

.nav__auth {
    display: flex;
    align-items: center;
    gap: 16px;
    justify-self: center;
    justify-content: center;
    flex-wrap: wrap;
}

.nav__welcome {
    color: #94a3b8;
    font-size: 0.95rem;
}

.app-shell__content {
    flex: 1;
    padding: 32px;
}

.app-toast {
    position: fixed;
    bottom: 32px;
    right: 32px;
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(148, 163, 184, 0.4);
    border-radius: var(--radius-lg);
    padding: 12px 18px;
    color: #f8fafc;
    box-shadow: 0 20px 45px rgba(15, 23, 42, 0.65);
    z-index: 50;
    font-size: 0.95rem;
}

.toast-fade-enter-active,
.toast-fade-leave-active {
    transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

@media (max-width: 768px) {
    .app-shell__nav {
        grid-template-columns: 1fr;
        text-align: center;
    }

    .nav__auth {
        justify-content: center;
    }
}

.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter-from {
    opacity: 0;
    transform: translateY(12px);
}

.fade-leave-to {
    opacity: 0;
    transform: translateY(-8px);
}

.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
    transition: opacity 0.25s ease, transform 0.25s ease;
}

.slide-left-enter-from {
    opacity: 0;
    transform: translateX(20px);
}

.slide-left-leave-to {
    opacity: 0;
    transform: translateX(-20px);
}

.slide-right-enter-from {
    opacity: 0;
    transform: translateX(-20px);
}

.slide-right-leave-to {
    opacity: 0;
    transform: translateX(20px);
}
</style>
