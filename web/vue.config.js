const { defineConfig } = require('@vue/cli-service')

// NOTA: Queste porte devono corrispondere a config/index.js
// - vueDev: 8080
// - botApi: 8082
const VUE_DEV_PORT = 8080
const BOT_API_URL = 'http://localhost:8082'

module.exports = defineConfig({
  transpileDependencies: true,

  // Development server configuration
  devServer: {
    port: VUE_DEV_PORT, // Pannello Vue su porta 8080 in sviluppo (sync con constants.ports.vueDev)

    // Proxy API calls and WebSocket to the bot server
    proxy: {
      '/api': {
        target: BOT_API_URL, // Sync con constants.ports.botApi
        changeOrigin: true,
        ws: true,
        logLevel: 'warn'
      },
      '/ws': {
        target: BOT_API_URL, // Sync con constants.ports.botApi
        changeOrigin: true,
        ws: true,
        logLevel: 'warn'
      }
    },

    // Disable host check for WebSocket connections
    allowedHosts: 'all',

    // WebSocket configuration
    client: {
      webSocketURL: 'auto://0.0.0.0:0/ws',
      logging: 'error',
      overlay: {
        warnings: false,
        errors: true
      },
      progress: false
    },

    devMiddleware: {
      stats: 'errors-only'
    }
  },

  // Production build output directory
  outputDir: '../public',

  // Public path configuration
  publicPath: process.env.NODE_ENV === 'production' ? '/' : '/'
})
