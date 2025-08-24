import Vue from "vue"
import Vuex from "vuex"

import session from "./modules/session"
import bot from "./modules/bot"
import users from "./modules/users"

Vue.use(Vuex)

const store = new Vuex.Store({
    modules: {
        session,
        bot,
        users
    }
})

export default store
