const path = require("path")
const { defineConfig } = require("@vue/cli-service")
const { constants } = require("../config")

const VUE_DEV_PORT = constants?.ports?.vueDev || 8080
const DEFAULT_API_TARGET = `http://localhost:${constants?.ports?.botApi || 8082}`
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

const normalizeTargetUrl = (url) => {
  if (!url) return DEFAULT_API_TARGET
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return `${url.origin}${pathname}`
}

const resolveProxyTarget = () => {
  const rawTarget = process.env.API_PROXY_TARGET || DEFAULT_API_TARGET
  try {
    const parsed = new URL(rawTarget)
    const isDockerEnv = process.env.DOCKER_ENV === "true"
    const host = parsed.hostname.toLowerCase()
    const isLoopback = LOOPBACK_HOSTS.has(host)
    const resemblesDockerService = !isLoopback && !host.includes(".")

    if (!isDockerEnv && resemblesDockerService) {
      parsed.hostname = "localhost"
      return normalizeTargetUrl(parsed)
    }

    return normalizeTargetUrl(parsed)
  } catch (error) {
    return DEFAULT_API_TARGET
  }
}

const BOT_API_URL = resolveProxyTarget()
const HMR_SOCKET_PATH = process.env.HMR_SOCKET_PATH || "/__hmr_panel"

module.exports = defineConfig({
  transpileDependencies: true,
  productionSourceMap: false,

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
