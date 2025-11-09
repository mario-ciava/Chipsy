import { createApp } from "vue"
import App from "./App.vue"
import router from "./router"
import store from "./store"

import "./assets/styles/tailwind.css"

const mountApp = () => {
    const app = createApp(App)
    app.use(router)
    app.use(store)
    app.mount("#app")
}

store.dispatch("session/bootstrap")
    .finally(async() => {
        try {
            if (store.getters["session/isAuthenticated"] && store.getters["session/isAdmin"]) {
                await Promise.all([
                    store.dispatch("bot/fetchStatus").catch((error) => {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to prefetch bot status", error)
                        return null
                    }),
                    store.dispatch("users/refresh").catch((error) => {
                        // eslint-disable-next-line no-console
                        console.warn("Failed to prefetch users list", error)
                        return null
                    })
                ])
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Failed to warm up dashboard data", error)
        } finally {
            mountApp()
        }
    })
