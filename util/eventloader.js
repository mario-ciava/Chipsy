const ev = (event) => require(`../events/${event}`)
module.exports = (client) => {
    client
        .on("ready", async() => {
            await ev("ready")(client)
        })
        .on("messageCreate", async(msg) => {
            await ev("msg")(msg)
        })
        .on("interactionCreate", async(interaction) => {
            await ev("interaction")(interaction)
        })
    process
        .on("uncaughtException", (err) => {
            ev("uncaughtException")(err)
        })
        .on("unhandledRejection", (err) => {
            ev("unhandledRejection")(err)
        })
}