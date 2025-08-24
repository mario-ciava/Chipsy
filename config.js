const path = require("path")
const { config: loadEnv } = require("dotenv")
const { z } = require("zod")

loadEnv({ path: process.env.CONFIG_PATH ? path.resolve(process.env.CONFIG_PATH) : undefined })

const envSchema = z.object({
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
    DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required."),
    DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required."),
    DISCORD_OWNER_ID: z.string().min(1, "DISCORD_OWNER_ID is required."),
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
    console.error("Configuration validation failed:")
    for (const issue of parsedEnv.error.issues) {
        const path = issue.path.join(".") || issue.code
        console.error(`- ${path}: ${issue.message}`)
    }
    process.exit(1)
}

const env = parsedEnv.data

module.exports = {
    discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        botToken: env.DISCORD_BOT_TOKEN,
        ownerId: env.DISCORD_OWNER_ID
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
        redirectOrigin: env.FRONTEND_REDIRECT_ORIGIN || "http://localhost:8082"
    }
}
