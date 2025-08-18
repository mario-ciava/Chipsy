const mysql = require("mysql2/promise")
const config = require("../config")

const ensureDatabase = async(connection, database) => {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
    await connection.changeUser({ database })
}

const columnMigrations = [
    { column: "money", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '5000'" },
    { column: "gold", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '1'" },
    { column: "hands_played", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '0'" },
    { column: "hands_won", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '0'" },
    { column: "biggest_won", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '0'" },
    { column: "biggest_bet", definition: "BIGINT UNSIGNED NOT NULL DEFAULT '0'" }
]

const migrateUsers = async(connection) => {
    const [tableExists] = await connection.query("SHOW TABLES LIKE ?", ["users"])
    if (!tableExists.length) {
        return
    }

    for (const { column, definition } of columnMigrations) {
        const [existing] = await connection.query("SHOW COLUMNS FROM ?? LIKE ?", ["users", column])
        if (!existing.length) {
            continue
        }

        const type = String(existing[0].Type || "").toLowerCase()
        const isBigInt = type.includes("bigint")
        const isUnsigned = type.includes("unsigned")

        if (isBigInt && isUnsigned) {
            continue
        }

        await connection.query(`ALTER TABLE \`users\` MODIFY \`${column}\` ${definition}`)
        console.info(`Updated users.${column} to BIGINT UNSIGNED`)
    }
}

const migrate = async() => {
    const connection = await mysql.createConnection({
        host: config.mysql.host,
        user: config.mysql.user ?? undefined,
        password: config.mysql.password ?? undefined,
        port: config.mysql.port,
        multipleStatements: true
    })

    try {
        await ensureDatabase(connection, config.mysql.database)
        await migrateUsers(connection)
        console.info("BIGINT column migration completed successfully.")
    } catch (error) {
        console.error("Failed to migrate BIGINT columns:", error)
        process.exitCode = 1
    } finally {
        await connection.end()
    }
}

migrate()
