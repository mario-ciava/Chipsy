const createServer = require("./express")
const { client, webSocket, bootstrap } = require("../bot")
const logger = require("../bot/utils/logger")
const constants = require("../config/constants")

// ============================================================================
// GRACEFUL SHUTDOWN: Mantiene riferimenti agli oggetti da chiudere
// ============================================================================
let httpServer = null
let mysqlShutdown = null
let isShuttingDown = false

/**
 * Gestisce il graceful shutdown del server:
 * 1. Chiude il server HTTP (smette di accettare nuove connessioni)
 * 2. Chiude le connessioni WebSocket attive
 * 3. Chiude il pool MySQL
 * 4. Termina il client Discord
 */
const gracefulShutdown = async(signal) => {
    if (isShuttingDown) {
        logger.warn("Shutdown already in progress", { scope: "server" })
        return
    }

    isShuttingDown = true
    logger.info(`Received ${signal} - Starting graceful shutdown...`, { scope: "server" })

    const shutdownTimer = setTimeout(() => {
        logger.error("Shutdown timeout - forcing exit", { scope: "server" })
        process.exit(1)
    }, constants.timeouts.serverShutdown)

    try {
        // Fase 1: Chiudi il server HTTP
        if (httpServer) {
            logger.info("Closing HTTP server...", { scope: "server" })
            await new Promise((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) {
                        logger.error("Error closing HTTP server", {
                            scope: "server",
                            message: err.message
                        })
                        reject(err)
                    } else {
                        logger.info("HTTP server closed", { scope: "server" })
                        resolve()
                    }
                })
            })
        }

        // Fase 2: Chiudi il pool MySQL
        if (mysqlShutdown) {
            logger.info("Closing MySQL pool...", { scope: "server" })
            await mysqlShutdown()
        }

        // Fase 3: Chiudi il client Discord
        if (client && client.isReady()) {
            logger.info("Destroying Discord client...", { scope: "server" })
            await client.destroy()
            logger.info("Discord client destroyed", { scope: "server" })
        }

        clearTimeout(shutdownTimer)
        logger.info("Graceful shutdown completed successfully", { scope: "server" })
        process.exit(0)
    } catch (error) {
        clearTimeout(shutdownTimer)
        logger.error("Error during graceful shutdown", {
            scope: "server",
            message: error.message
        })
        process.exit(1)
    }
}

// Registra gli handler per i segnali di terminazione
process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

// Gestione errori globali per prevenire crash non gestiti
process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception detected", {
        scope: "server",
        message: error.message,
        stack: error.stack
    })
    gracefulShutdown("uncaughtException")
})

process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled promise rejection detected", {
        scope: "server",
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    })
    gracefulShutdown("unhandledRejection")
})

const start = async() => {
    try {
        // Bootstrap del bot (connessione Discord + MySQL)
        const result = await bootstrap()

        // Salva la funzione di shutdown MySQL se disponibile
        if (result && result.mysql && result.mysql.shutdown) {
            mysqlShutdown = result.mysql.shutdown
        }

        const port = Number(process.env.PORT) || constants.server.defaultPort

        // Crea ed avvia il server Express
        const app = createServer(client, webSocket, {
            port,
            listen: true,
            statusService: client.statusService
        })

        // Salva il riferimento al server HTTP per graceful shutdown
        httpServer = app.httpServer

        // Gestisci eventuali errori durante l'avvio del server
        if (httpServer) {
            httpServer.on("error", (error) => {
                logger.error("HTTP server error", {
                    scope: "server",
                    message: error.message,
                    code: error.code
                })

                if (error.code === "EADDRINUSE") {
                    logger.error(`Port ${port} is already in use. Please free the port or change PORT in .env`, {
                        scope: "server"
                    })
                    process.exit(1)
                }
            })
        }

        logger.info(`Control panel listening on port ${port}`, { scope: "server" })
        logger.info("Press Ctrl+C to shutdown gracefully", { scope: "server" })
    } catch (error) {
        logger.error("Failed to start control panel server", {
            scope: "server",
            message: error.message,
            stack: error.stack
        })
        process.exit(1)
    }
}

start()
