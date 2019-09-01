import Vue from 'vue'
import Router from 'vue-router'
import { routes } from './routes'

Vue.use(Router);

export const router = new Router({
    mode: 'history',
    routes
});

router.beforeEach((to, from, next) => {
    if (to.matched.some(r => r.meta.reqAuth)) {
        //
    }
    next()
})