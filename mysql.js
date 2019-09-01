const mysql = require("mysql")
    dbName = "app_data"
module.exports = (client) => {
    var connection = mysql.createConnection({
        host: "localhost",
        user: client.config.id,
        password: client.config.secret,
        port: 5000
    })

    connection.connect(async(err) => {
        if (err) return console.error(err)
        console.info(`\n${("-").repeat(40)}\nConnected to mysql with id: ${connection.threadId} | Port: 5000\n${("-").repeat(40)}`)
        await require("./util/mysqlcreator.js")(connection, dbName)
        client.connection = connection
    })
}