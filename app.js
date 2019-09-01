try {
    global.Discord = require("discord.js")
    global.app = new Discord.Client()
    
    const EventEmitter = require("events")

    class ws extends EventEmitter {};
    const webSocket = new ws();

    app.config = require("./config.json")
    app.commands = []
    app.connection = null
    global.DR = require("./util/datahandler.js")

    app.init = async() => {
        await require("./util/eventloader.js")(app)
        await require("./util/commandloader.js")(app)
        await require("./mysql.js")(app)

        global.setSeparator = (number) => {
            if (isNaN(number)) return null
            return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
        }
    
        app.login(app.config.token)
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


