<template>
    <div class="app-shell">
        <header class="app-shell__nav">
            <div class="nav__brand">
                <router-link to="/">Chipsy</router-link>
            </div>
            <nav class="nav__links">
                <router-link exact to="/">Home</router-link>
                <router-link v-if="isAdmin" to="/control_panel">Pannello</router-link>
            </nav>
            <div class="nav__auth">
                <span v-if="isAuthenticated" class="nav__welcome">
                    Benvenuto {{ userName }}
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
            <router-view />
        </main>
    </div>
</template>

<script>
import { mapGetters } from "vuex"

export default {
    name: "App",
    computed: {
        ...mapGetters("session", ["isAuthenticated", "isAdmin", "user"]),
        userName() {
            return this.user && this.user.username ? this.user.username : ""
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 32px;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(24px);
    border-bottom: 1px solid rgba(148, 163, 184, 0.15);
    position: sticky;
    top: 0;
    z-index: 10;
}

.nav__brand a {
    font-size: 1.25rem;
    font-weight: 600;
    color: #f8fafc;
    text-decoration: none;
}

.nav__links {
    display: flex;
    gap: 16px;
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
}

.nav__welcome {
    color: #94a3b8;
    font-size: 0.95rem;
}

.app-shell__content {
    flex: 1;
    padding: 32px;
}
</style>
