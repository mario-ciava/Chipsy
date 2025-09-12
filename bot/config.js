const { config: loadEnv } = require("dotenv")
const { z } = require("zod")
const constants = require("../config/constants")

// ============================================================================
// CONFIGURAZIONE: Validazione environment variables con Zod
//
// ARCHITETTURA HOST DETECTION:
// La detection dell'ambiente (localhost vs Docker) è gestita PRIMA di questo
// file, da devRunner.mjs (entry point). Questo file si limita a validare che
// le variabili siano presenti e nei formati corretti.
//
// Flusso di detection:
// 1. devRunner.mjs → setta process.env.MYSQL_HOST (localhost o mysql)
// 2. bot/config.js → valida e fornisce default se non settato
// 3. bot/mysql.js → usa semplicemente config.mysql.host
//
// Default MYSQL_HOST = "localhost" perché:
// - Su macOS Docker Desktop, "localhost" funziona correttamente
// - "127.0.0.1" causa problemi di user@host mismatch in MySQL
// - In Docker, devRunner.mjs lo sovrascrive con "mysql" (service name)
// ============================================================================

// Load environment variables
const result = loadEnv()
if (result?.error) {
    throw result.error
}

const envSchema = z.object({
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
    DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required."),
    DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required."),
    DISCORD_OWNER_ID: z.string().min(1, "DISCORD_OWNER_ID is required."),
    DISCORD_TEST_GUILD_ID: z.string().optional(),
    COMMAND_PREFIX: z.string().min(1, "COMMAND_PREFIX is required."),
    MYSQL_HOST: z.string().min(1, "MYSQL_HOST is required.").default("localhost"),
    MYSQL_PORT: z.coerce.number().int().positive("MYSQL_PORT must be a positive integer.").default(3306),
    MYSQL_DATABASE: z.string().min(1, "MYSQL_DATABASE is required.").default("app_data"),
    MYSQL_USER: z.string().optional(),
    MYSQL_PASSWORD: z.string().optional(),
    FRONTEND_REDIRECT_ORIGIN: z.string().optional()
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
    // Usa console.error (non logger) perché il logger potrebbe non essere ancora inizializzato
    console.error("\n❌ Configuration validation failed:")
    for (const issue of parsedEnv.error.issues) {
        const path = issue.path.join(".") || issue.code
        console.error(`   - ${path}: ${issue.message}`)
    }
    console.error("\nPlease check your .env file and ensure all required variables are set correctly.\n")
    process.exit(1)
}

const env = parsedEnv.data

module.exports = {
    discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        botToken: env.DISCORD_BOT_TOKEN,
        ownerId: env.DISCORD_OWNER_ID,
        testGuildId: env.DISCORD_TEST_GUILD_ID
    },
    bot: {
        prefix: env.COMMAND_PREFIX,
        enabled: true
    },
    mysql: {
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        database: env.MYSQL_DATABASE,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD
    },
    web: {
        redirectOrigin: env.FRONTEND_REDIRECT_ORIGIN || constants.urls.botApiLocal
    },
    blackjack: {
        // Game settings with default values and allowed ranges
        deckCount: {
            default: 6, // Number of 52-card decks to use
            allowedRange: { min: 1, max: 8 }
        },
        reshuffleThreshold: {
            default: 52, // Reshuffle when fewer than this many cards remain (1 deck)
            allowedRange: { min: 20, max: 104 } // 20 cards to 2 decks
        },
        maxPlayersDefault: {
            default: 7, // Default maximum players when not specified
            allowedRange: { min: 1, max: 7 }
        },
        minPlayers: {
            default: 2,
            allowedRange: { min: 2, max: 7 }
        },

        // Timing settings (in milliseconds) with allowed ranges
        lobbyTimeout: {
            default: 5 * 60 * 1000, // 5 minutes - how long lobby stays open
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 } // 1-15 minutes
        },
        betsTimeout: {
            default: 45 * 1000, // 45 seconds - time to place bets
            allowedRange: { min: 10 * 1000, max: 120 * 1000 } // 10-120 seconds
        },
        actionTimeout: {
            default: 45 * 1000, // 45 seconds - time per player action (hit/stand/etc)
            allowedRange: { min: 15 * 1000, max: 120 * 1000 } // 15-120 seconds
        },
        modalTimeout: {
            default: 25 * 1000, // 25 seconds - time to submit modal forms
            allowedRange: { min: 10 * 1000, max: 60 * 1000 } // 10-60 seconds
        },
        autobetShortTimeout: {
            default: 3 * 1000, // 3 seconds - short timeout when all bets placed via autobet
            allowedRange: { min: 1 * 1000, max: 10 * 1000 } // 1-10 seconds
        },

        // Display settings
        timelineMaxEntries: {
            default: 30, // Maximum number of timeline entries to keep
            allowedRange: { min: 10, max: 100 }
        }
    },
    texas: {
        // Timing settings (in milliseconds)
        actionTimeout: {
            default: 45 * 1000, // 45 seconds - time per player action
            allowedRange: { min: 15 * 1000, max: 120 * 1000 }
        },
        collectorTimeout: {
            default: 5 * 60 * 1000, // 5 minutes - how long action collector stays open
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 }
        },
        modalTimeout: {
            default: 60 * 1000, // 60 seconds - time to submit modal forms
            allowedRange: { min: 10 * 1000, max: 120 * 1000 }
        },
        nextHandDelay: {
            default: 8 * 1000, // 8 seconds - delay before starting next hand
            allowedRange: { min: 3 * 1000, max: 20 * 1000 }
        },
        // Game rules
        minPlayers: {
            default: 2,
            allowedRange: { min: 2, max: 9 }
        },
        maxPlayers: {
            default: 9,
            allowedRange: { min: 2, max: 9 }
        },

        // Bet and buy-in settings
        minBet: {
            default: 100,
            allowedRange: { min: 10, max: 1000 }
        },
        maxBuyIn: {
            default: 10000,
            allowedRange: { min: 100, max: 100000 }
        }
    },
    lobby: {
        debounceDelay: {
            default: 350, // ms - debounce for UI refreshes
            allowedRange: { min: 100, max: 1000 }
        },
        collectorTimeout: {
            default: 5 * 60 * 1000, // 5 minutes
            allowedRange: { min: 60 * 1000, max: 15 * 60 * 1000 }
        },
        modalTimeout: {
            default: 60 * 1000, // 60 seconds
            allowedRange: { min: 15 * 1000, max: 120 * 1000 }
        }
    },
    delays: {
        // Standardized sleep delays (in milliseconds)
        short: {
            default: 2000,
            allowedRange: { min: 500, max: 5000 }
        },
        medium: {
            default: 3500,
            allowedRange: { min: 1000, max: 10000 }
        },
        long: {
            default: 5000,
            allowedRange: { min: 2000, max: 15000 }
        }
    }
}
