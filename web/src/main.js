/*eslint-disable*/
import Vue from 'vue'
import VueCookies from 'vue-cookies'
import App from './App.vue'
import { router } from './router/index.js'
import Methods from './methods.js'

Vue.config.productionTip = false

VueCookies.config('7d')
Vue.use(VueCookies)

new Vue({
  el: "#app",
  router,
  methods: Methods,
  data() {
    return {
      user: {
        token: this.$cookies.get("_token") || null,
        info: null
      }
    }
  },
  render: h => h(App)
});