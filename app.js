try {
    const { Client, GatewayIntentBits, Partials, Collection, REST } = require("discord.js")
    global.Discord = require("discord.js")
    global.app = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ],
        partials: [Partials.Channel, Partials.Message]
    })

    const EventEmitter = require("events")

    class ws extends EventEmitter {};
    const webSocket = new ws();

    app.config = require("./config.json")
    app.commands = new Collection()
    app.slashCommands = new Collection()
    app.connection = null
    global.DR = require("./util/datahandler.js")
    app.rest = new REST({ version: "10" }).setToken(app.config.token)

    const CommandRouter = require("./util/commandRouter.js")
    app.commandRouter = new CommandRouter(app)
    app.commands = app.commandRouter.messageCommands
    app.slashCommands = app.commandRouter.slashCommands

    app.init = async() => {
        await require("./util/eventloader.js")(app)
        await require("./util/commandloader.js")(app)
        await require("./mysql.js")(app)

        global.setSeparator = (number) => {
            if (isNaN(number)) return null
            return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
        }
    
        try {
            await app.login(app.config.token)
        } catch (loginError) {
            console.error("Failed to login to Discord:", loginError)
            process.exit(1)
        }
    }

    app.init()

    //require("./server/express.js")(app, webSocket)

    app.SetData = async(user) => {
        let output = await new Promise((resolve, reject) => {
            DR.getUserData(user.id).then((u) => {
                if (u) {
                    user.data = u
                    resolve(user.data)
                } else {
                    DR.createUserData(user.id).then((u) => {
                        if (u) {
                            user.data = u
                            return resolve(user.data)
                        } else {
                            reject()
                        }
                    })
                }
            })
        })
        return output
    }

} catch (error) {
    console.log(error)
}


