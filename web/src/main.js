import Vue from "vue"
import VueCookies from "vue-cookies"

import App from "./App.vue"
import router from "./router"
import store from "./store"

import "./assets/styles/base.css"

Vue.config.productionTip = false

VueCookies.config("7d")
Vue.use(VueCookies)

const mountApp = () => new Vue({
    router,
    store,
    render: (h) => h(App)
}).$mount("#app")

store.dispatch("session/bootstrap")
    .finally(async() => {
        try {
            if (store.getters["session/isAuthenticated"] && store.getters["session/isAdmin"]) {
                await Promise.all([
                    store.dispatch("bot/fetchStatus").catch(() => null),
                    store.dispatch("users/refresh").catch(() => null)
                ])
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.warn("Failed to warm up dashboard data", error)
        } finally {
            mountApp()
        }
    })
