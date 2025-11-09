import { createStore } from "vuex"

import session from "./modules/session"
import bot from "./modules/bot"
import users from "./modules/users"
import logs from "./modules/logs"

const store = createStore({
    modules: {
        session,
        bot,
        users,
        logs
    }
})

export default store
