const ev = (event) => require(`../events/${event}`)
module.exports = (client) => {
    client
        .on("ready", () => {
            ev("ready")(client)
        })
        .on("message", (msg) => {
            ev("msg")(msg)
        })
    process
        .on("uncaughtException", (err) => {
            ev("uncaughtException")(err)
        })
        .on("unhandledRejection", (err) => {
            ev("unhandledRejection")(err)
        })
}