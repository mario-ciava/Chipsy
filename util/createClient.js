const { Client, GatewayIntentBits, Partials, Collection, REST } = require("discord.js")
const CommandRouter = require("./commandRouter")

const createClient = (config) => {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages
        ],
        partials: [
            Partials.Channel,
            Partials.Message,
            Partials.Reaction,
            Partials.User
        ]
    })

    client.commands = new Collection()
    client.slashCommands = new Collection()
    client.connection = null
    client.commandRouter = new CommandRouter(client)
    client.rest = new REST({ version: "10" }).setToken(config.discord.botToken)
    client.config = {
        id: config.discord.clientId,
        secret: config.discord.clientSecret,
        token: config.discord.botToken,
        ownerid: config.discord.ownerId,
        owner: config.discord.ownerId,
        prefix: config.bot.prefix,
        enabled: config.bot.enabled
    }

    return client
}

module.exports = {
    createClient
}
