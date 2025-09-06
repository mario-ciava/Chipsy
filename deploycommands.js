const { REST, Routes } = require("discord.js");
const fs = require("fs");
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
    console.log(`Aggiornamento di ${commands.length} comandi per la guild ${GUILD_ID}...`);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log("✅ Comandi slash registrati con successo (GUILD).");
  } catch (error) {
    console.error("❌ Errore durante la registrazione dei comandi:", error);
  }
})();
