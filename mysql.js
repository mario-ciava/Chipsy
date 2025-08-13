const mysql = require("mysql")

const initializeMySql = (client, config) => {
    const connection = mysql.createConnection({
        host: config.mysql.host,
        user: config.mysql.user,
        password: config.mysql.password,
        port: config.mysql.port
    })

    return new Promise((resolve, reject) => {
        connection.connect(async(err) => {
            if (err) {
                console.error("Failed to connect to MySQL:", err)
                return reject(err)
            }

            console.info(`\n${("-").repeat(40)}\nConnected to mysql with id: ${connection.threadId} | Port: ${config.mysql.port}\n${("-").repeat(40)}\n`)

            try {
                await require("./util/mysqlcreator.js")(connection, config.mysql.database)
                client.connection = connection
                resolve(connection)
            } catch (error) {
                reject(error)
            }
        })
    })
}

module.exports = initializeMySql
