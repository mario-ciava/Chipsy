import Vue from "vue"
import Router from "vue-router"

import store from "../store"

import HomeView from "../views/HomeView.vue"
import LoginView from "../views/LoginView.vue"
import LogoutView from "../views/LogoutView.vue"
import DashboardView from "../views/DashboardView.vue"
import UserDetailView from "../views/UserDetailView.vue"

Vue.use(Router)

const router = new Router({
    mode: "history",
    routes: [
        {
            path: "/",
            name: "Home",
            component: HomeView
        },
        {
            path: "/login",
            name: "Login",
            component: LoginView,
            meta: {
                requiresVisitor: true
            }
        },
        {
            path: "/logout",
            name: "Logout",
            component: LogoutView,
            meta: {
                requiresAuth: true
            }
        },
        {
            path: "/dashboard",
            alias: "/control_panel",
            name: "ControlPanel",
            component: DashboardView,
            meta: {
                requiresAuth: true,
                requiresAdmin: true
            }
        },
        {
            path: "/users/:id",
            name: "UserDetail",
            component: UserDetailView,
            meta: {
                requiresAuth: true,
                requiresAdmin: true
            }
        }
    ]
})

router.beforeEach(async(to, from, next) => {
    try {
        if (!store.state.session.initialized) {
            await store.dispatch("session/bootstrap")
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to bootstrap session", error)
    }

    const isAuthenticated = store.getters["session/isAuthenticated"]
    const isAdmin = store.getters["session/isAdmin"]

    if (to.query.code && to.name !== "Home" && to.query.state !== "controlPanelInvite") {
        return next({
            name: "Home",
            query: to.query
        })
    }

    if (to.matched.some((route) => route.meta && route.meta.requiresAuth) && !isAuthenticated) {
        return next({
            name: "Login",
            query: to.query.redirect ? to.query : { redirect: to.fullPath }
        })
    }

    if (to.matched.some((route) => route.meta && route.meta.requiresVisitor) && isAuthenticated) {
        return next({ name: "ControlPanel" })
    }

    if (to.matched.some((route) => route.meta && route.meta.requiresAdmin) && !isAdmin) {
        return next({ name: "Home" })
    }

    return next()
})

export default router
