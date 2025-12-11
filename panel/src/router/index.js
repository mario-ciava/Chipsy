import { createRouter, createWebHistory } from "vue-router"

import store from "../store"

import HomePage from "../features/home/HomePage.vue"
import LoginPage from "../features/auth/LoginPage.vue"
import LogoutPage from "../features/auth/LogoutPage.vue"
import DashboardPage from "../features/dashboard/DashboardPage.vue"
import UserDetailPage from "../features/users/UserDetailPage.vue"
import LogsPage from "../features/logs/LogsPage.vue"
import TablesPage from "../features/tables/TablesPage.vue"
import LeaderboardPage from "../pages/Leaderboard.vue"

const router = createRouter({
    history: createWebHistory(),
    routes: [
        {
            path: "/",
            name: "Home",
            component: HomePage
        },
        {
            path: "/login",
            name: "Login",
            component: LoginPage,
            meta: {
                requiresVisitor: true
            }
        },
        {
            path: "/logout",
            name: "Logout",
            component: LogoutPage,
            meta: {
                requiresAuth: true
            }
        },
        {
            path: "/dashboard",
            alias: "/control_panel",
            name: "ControlPanel",
            component: DashboardPage,
            meta: {
                requiresAuth: true,
                requiresPanel: true
            }
        },
        {
            path: "/logs",
            name: "Logs",
            component: LogsPage,
            meta: {
                requiresAuth: true,
                requiresLogs: true
            }
        },
        {
            path: "/tables",
            name: "Tables",
            component: TablesPage,
            meta: {
                requiresAuth: true,
                requiresLogs: true
            }
        },
        {
            path: "/users/:id",
            name: "UserDetail",
            component: UserDetailPage,
            meta: {
                requiresAuth: true,
                requiresPanel: true
            }
        },
        {
            path: "/:pathMatch(.*)*",
            redirect: { name: "Home" }
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
    const hasPanelAccess = store.getters["session/isAdmin"]
    const canViewLogs = store.getters["session/canViewLogs"]

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
        const fallback = to.query.redirect || "/"
        return next(fallback)
    }

    if (to.matched.some((route) => route.meta && route.meta.requiresPanel) && !hasPanelAccess) {
        return next({ name: "Home" })
    }

    if (to.matched.some((route) => route.meta && route.meta.requiresLogs) && !canViewLogs) {
        return next({ name: "Home" })
    }

    return next()
})

export default router
