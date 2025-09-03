/**
 * ============================================================================
 * CONFIGURAZIONE CENTRALIZZATA - Costanti di Sistema
 * ============================================================================
 *
 * Questo file contiene TUTTE le costanti operative del sistema.
 * Valori hardcoded sparsi nel codice sono stati centralizzati qui per:
 *
 * - Facile manutenzione: un solo posto dove modificare i valori
 * - Coerenza: stessi timeout/limiti in tutto il sistema
 * - Documentazione: ogni valore ha una spiegazione del suo scopo
 * - Testing: facile mockare/override per test
 *
 * IMPORTANTE: Questo file contiene valori che NON cambiano tra ambienti.
 * Per configurazioni environment-specific (DB host, token, etc.) vedi bot/config.js
 * ============================================================================
 */

module.exports = {
    /**
     * TIMEOUTS - Durata massima delle operazioni prima di forzare terminazione
     */
    timeouts: {
        // Graceful shutdown del server (HTTP + MySQL + Discord)
        // Abbastanza lungo da permettere completamento richieste in corso
        serverShutdown: 15000, // 15 secondi

        // Graceful shutdown del pool MySQL
        // Attende completamento query in corso prima di chiudere connessioni
        mysqlShutdown: 10000, // 10 secondi

        // Graceful shutdown del DevRunner (SIGINT → SIGKILL)
        // Tempo dato ai processi figli per terminare volontariamente
        devRunnerShutdown: 10000, // 10 secondi

        // Attesa che MySQL container diventi "healthy" all'avvio
        // 25 secondi @ 1s per tentativo = max 25 tentativi
        mysqlHealthcheck: 25000, // 25 secondi
    },

    /**
     * RETRY & BACKOFF - Logica di retry per operazioni che possono fallire temporaneamente
     */
    retry: {
        // Tentativi di connessione al pool MySQL (all'avvio)
        // MySQL può impiegare 2-5s a diventare pronto dopo docker-compose up
        mysql: {
            maxAttempts: 5,
            baseDelay: 250, // ms - raddoppia ad ogni tentativo (250, 500, 1000, 2000, 4000)
        },

        // Restart automatico processi figli in devRunner
        // Dopo 5 crash consecutivi, il processo non viene più riavviato
        childProcess: {
            maxRestarts: 5,
            maxDelay: 5000, // ms - delay massimo tra restart (con backoff esponenziale)
        },
    },

    /**
     * DATABASE - Configurazione pool MySQL
     */
    database: {
        pool: {
            // Numero massimo di connessioni nel pool
            // 10 è un buon bilanciamento per un bot Discord medio
            connectionLimit: 10,

            // 0 = nessun limite alla coda di attesa
            // Richieste oltre connectionLimit vengono messe in coda
            queueLimit: 0,

            // true = le richieste aspettano se non ci sono connessioni disponibili
            // false = le richieste falliscono immediatamente
            waitForConnections: true,
        },

        // Starting money per nuovi utenti
        defaultMoney: 5000,
    },

    /**
     * PORTS - Tutte le porte utilizzate dal sistema
     * Centralizzate per evitare duplicazioni e inconsistenze
     */
    ports: {
        // Bot API Server (Express)
        // Usato in: server/index.js, bot/config.js, server/express.js
        botApi: 8082,

        // Vue Dev Server (webpack-dev-server in development)
        // Usato in: web/vue.config.js, web/package.json, server/express.js CORS
        vueDev: 8080,

        // Legacy port (mantenuto per CORS compatibility)
        vueLegacy: 8081,

        // MySQL Database
        mysql: 3306,

        // Fallback generico (legacy)
        // NOTA: Probabilmente non più usato, ma mantenuto per retrocompatibilità
        legacy: 3000,
    },

    /**
     * URLS - URL completi per evitare duplicazioni "http://localhost:XXXX"
     * Getter dinamici che costruiscono gli URL dalle porte
     */
    get urls() {
        return {
            // Bot API Server URL (localhost)
            botApiLocal: `http://localhost:${this.ports.botApi}`,

            // Vue Dev Server URL (localhost)
            vueDevLocal: `http://localhost:${this.ports.vueDev}`,

            // Legacy URL
            vueLegacyLocal: `http://localhost:${this.ports.vueLegacy}`,

            // Fallback legacy
            legacyLocal: `http://localhost:${this.ports.legacy}`,
        }
    },

    /**
     * SERVER - Configurazione Express e middleware
     */
    server: {
        // Porta di default se PORT non è in .env (usa ports.botApi)
        get defaultPort() {
            return module.exports.ports.botApi
        },

        // Durata sessione utente (cookie maxAge)
        // 24 ore in millisecondi
        sessionMaxAge: 24 * 60 * 60 * 1000,

        // HSTS (HTTP Strict Transport Security) max age
        // 1 anno in secondi per production security
        hstsMaxAge: 31536000,

        // Rate limiting globale
        rateLimiter: {
            // Finestra temporale (15 minuti)
            windowMs: 15 * 60 * 1000,

            // Max richieste per finestra per IP
            max: 1000,
        },

        // Limiti richieste body
        bodyLimit: "10mb",
    },

    /**
     * LOGGING - Configurazione Winston logger
     */
    logging: {
        // Dimensione massima file di log prima di rotazione
        // 5MB in bytes
        maxFileSize: 5 * 1024 * 1024,

        // Numero massimo di file di log da mantenere
        maxFiles: 5,
    },

    /**
     * GAMES - Timeout e limiti per giochi (Texas Hold'em, Blackjack, etc.)
     */
    games: {
        // Timeout risposta giocatore (Blackjack, Upgrade, etc.)
        playerActionTimeout: 30000, // 30 secondi

        // Timeout per upgrade confirmation
        upgradeConfirmTimeout: 180000, // 3 minuti

        // Timeout turno Texas Hold'em
        texasHoldemTurnTimeout: 45000, // 45 secondi
    },

    /**
     * DEVELOPMENT - Configurazioni specifiche per ambiente di sviluppo
     */
    development: {
        // Delay tra avvio bot e panel nel devRunner
        // Piccolo offset per separare output nei log
        panelStartDelay: 1500, // 1.5 secondi

        // Intervallo polling healthcheck MySQL durante startup
        healthcheckInterval: 1000, // 1 secondo
    },
}
