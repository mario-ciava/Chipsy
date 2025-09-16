const { REST, Routes } = require("discord.js");
const fs = require("fs");
const logger = require("./bot/utils/logger");
require("dotenv").config();

// Carica tutti i comandi dalla cartella ./commands
const commands = [];
const commandFiles = fs.readdirSync("./bot/commands").filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(`./bot/commands/${file}`);
  if (command.data) commands.push(command.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);

// Identificativi
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // ID della tua applicazione/bot
const GUILD_ID = "605327908525047808";   // ID del server target

(async () => {
  try {
    logger.info(`Aggiornamento di ${commands.length} comandi per la guild ${GUILD_ID}...`, {
      scope: "deployCommands",
      guildId: GUILD_ID,
      count: commands.length
    });

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    logger.info("Comandi slash registrati con successo (GUILD).", {
      scope: "deployCommands",
      icon: "✅",
      guildId: GUILD_ID
    });
  } catch (error) {
    logger.error("Errore durante la registrazione dei comandi slash", {
      scope: "deployCommands",
      guildId: GUILD_ID,
      message: error?.message,
      stack: error?.stack
    });
  }
})();
