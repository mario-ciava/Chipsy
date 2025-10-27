const path = require("path")
const { defineConfig } = require("@vue/cli-service")

// NOTA: Queste porte devono corrispondere a config/index.js
// - vueDev: 8080
// - botApi: 8082
const VUE_DEV_PORT = 8080
const BOT_API_URL = process.env.API_PROXY_TARGET || "http://localhost:8082"
const HMR_SOCKET_PATH = process.env.HMR_SOCKET_PATH || "/__hmr_panel"

module.exports = defineConfig({
  transpileDependencies: true,

  chainWebpack: (config) => {
    if (!config.resolve.extensions.has(".ts")) {
      config.resolve.extensions.add(".ts")
    }
    config.module
      .rule("ts")
      .test(/\.ts$/)
      .use("babel-loader")
      .loader("babel-loader")
      .end()
  },

  // Development server configuration
  devServer: {
    port: VUE_DEV_PORT, // Pannello Vue su porta 8080 in sviluppo (sync con constants.ports.vueDev)

    // Proxy API calls and WebSocket to the bot server
    proxy: {
      '/api/v1': {
        target: BOT_API_URL,
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
      webSocketURL: `auto://0.0.0.0:0${HMR_SOCKET_PATH}`,
      logging: 'error',
      overlay: {
        warnings: false,
        errors: true
      },
      progress: false
    },

    webSocketServer: {
      options: {
        path: HMR_SOCKET_PATH
      }
    },

    devMiddleware: {
      stats: 'errors-only'
    }
  },

  // Production build output directory (kept inside panel/ to avoid polluting the root workspace)
  outputDir: path.resolve(__dirname, "dist"),

  // Public path configuration
  publicPath: process.env.NODE_ENV === 'production' ? '/' : '/'
})
