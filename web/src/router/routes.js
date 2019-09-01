import Home from '@/components/Home.vue'
import Login from '@/components/Login.vue'
import Logout from '@/components/Logout.vue'
import Panel from '@/components/Panel.vue'
import Admin from '@/components/Admin.vue'
import Guild from '@/components/Guild.vue';

export const routes = [
    {
        path: "/",
        name: "Home",
        component: Home
    },
    {
        path: "/login",
        name: "Login",
        component: Login,
        meta: {
            reqVisitor: true
        }
    },
    {
        path: "/logout",
        name: "Logout",
        component: Logout,
        meta: {
            reqAuth: true
        }
    },
    {
        path: "/control_panel",
        name: "Control Panel",
        component: Panel,
        meta: {
            reqAuth: true
        }
    },
    {
        path: "/admin",
        name: "Admin",
        component: Admin,
        meta: {
            reqAdmin: true
        }
    },
]