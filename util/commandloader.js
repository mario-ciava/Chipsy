module.exports = (client) => {
    const fs = require("fs")
    fs.readdir("./commands/", (err, files) => {
        if (err) return console.error(err)
        files.forEach((file) => {
            let data = require(`../commands/${file}`)
            client.commands.push(data)
        })
    })
}
