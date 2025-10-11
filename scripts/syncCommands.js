#!/usr/bin/env node
const path = require("path")
const fs = require("fs")
const { REST, Routes } = require("discord.js")
const logger = require("../shared").logger
const dotenvPath = path.resolve(process.cwd(), ".env")
if (fs.existsSync(dotenvPath)) {
    require("dotenv").config({ path: dotenvPath })
}
const extraEnv = process.env.CHIPSY_ENV ? `.env.${process.env.CHIPSY_ENV}` : null
if (extraEnv) {
    const variantPath = path.resolve(process.cwd(), extraEnv)
    if (fs.existsSync(variantPath)) {
        require("dotenv").config({ path: variantPath, override: true })
    }
}
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const CLIENT_ID = process.env.DISCORD_CLIENT_ID
const GUILD_ID = process.env.SLASH_COMMAND_GUILD_ID || process.env.DISCORD_TEST_GUILD_ID
if (!BOT_TOKEN || !CLIENT_ID) {
    console.error("DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID are required to sync commands.")
    process.exit(1)
}
if (!GUILD_ID) {
    console.error("Set SLASH_COMMAND_GUILD_ID or DISCORD_TEST_GUILD_ID to target a guild.")
    process.exit(1)
}
const commandsDir = path.resolve(__dirname, "../bot/commands")
const commandFiles = fs.readdirSync(commandsDir).filter((file) => file.endsWith(".js"))
const commands = []
for (const file of commandFiles) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const command = require(path.join(commandsDir, file))
    if (command?.data?.toJSON) {
        commands.push(command.data.toJSON())
    }
}
const rest = new REST({ version: "10" }).setToken(BOT_TOKEN)
;(async() => {
    try {
        logger.info(`Syncing ${commands.length} commands to guild ${GUILD_ID}`, { scope: "slash-sync" })
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })
        logger.info("Slash commands synced", { scope: "slash-sync", icon: "✅" })
    } catch (error) {
        logger.error("Failed to sync slash commands", {
            scope: "slash-sync",
            message: error.message,
            stack: error.stack
        })
        process.exit(1)
    }
})()
