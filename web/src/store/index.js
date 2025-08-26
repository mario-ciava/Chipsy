import Vue from "vue"
import Vuex from "vuex"

import session from "./modules/session"
import bot from "./modules/bot"
import users from "./modules/users"
import logs from "./modules/logs"

Vue.use(Vuex)

const store = new Vuex.Store({
    modules: {
        session,
        bot,
        users,
        logs
    }
})

export default store
