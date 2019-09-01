<template>
  <div id="app">
    <ul>
      <li><router-link to="/">Main</router-link></li>
      <li><router-link to="/control_panel">Panel</router-link></li>
      <li v-if="this.$root.user.info && this.$root.user.info.isAdmin"><router-link to="/admin">Admin</router-link></li>
      <li style="float:right" v-if="!this.$root.user.token"><router-link to="/login" class="active">Login</router-link></li>
      <li style="float:right" v-else-if="this.$root.user.token"><router-link to="/logout" class="active">Logout</router-link></li>
    </ul>
    <router-view/>
  </div>
</template>

<script>
export default {
  name: 'app'
}
</script>

<style scoped>
ul {
  list-style-type: none;
  margin: 0;
  padding: 0;
  overflow: hidden;
  background-color: #333;
}

li {
  float: left;
}

li a {
  display: block;
  color: white;
  text-align: center;
  padding: 14px 16px;
  text-decoration: none;
}

li a:hover:not(.active) {
  background-color: #111;
}

.active {
  background-color: #4CAF50;
}
</style>
