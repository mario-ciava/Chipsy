const mysql = require("mysql2/promise")
const config = require("../config")
const logger = require("../bot/utils/logger")
const { BASE_REQUIRED_EXP, calculateRequiredExp, normalizeUserExperience } = require("../bot/utils/experience")

const ensureDatabase = async(connection, database) => {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``)
    await connection.changeUser({ database })
}

const ensureColumn = async(connection, table, columnDefinition) => {
    const match = columnDefinition.match(/`([^`]+)`/)
    if (!match) throw new Error(`Invalid column definition: ${columnDefinition}`)
    const column = match[1]

    const [existing] = await connection.query("SHOW COLUMNS FROM ?? LIKE ?", [table, column])
    if (!existing.length) {
        await connection.query(`ALTER TABLE ?? ADD COLUMN ${columnDefinition}`, [table])
    }
}

const dropColumnIfExists = async(connection, table, column) => {
    const [existing] = await connection.query("SHOW COLUMNS FROM ?? LIKE ?", [table, column])
    if (existing.length) {
        await connection.query("ALTER TABLE ?? DROP COLUMN ??", [table, column])
    }
}

const migrateUsers = async(connection) => {
    const [tableExists] = await connection.query("SHOW TABLES LIKE ?", ["users"])
    if (!tableExists.length) {
        return
    }

    await ensureColumn(connection, "users", "`current_exp` INT(10) UNSIGNED NOT NULL DEFAULT '0' AFTER `gold`")
    await ensureColumn(connection, "users", `\`required_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '${BASE_REQUIRED_EXP}' AFTER \`current_exp\``)

    const [legacyExpColumn] = await connection.query("SHOW COLUMNS FROM ?? LIKE ?", ["users", "exp"])
    if (legacyExpColumn.length) {
        await connection.query("UPDATE `users` SET `current_exp` = `exp` WHERE `current_exp` = 0")
    }

    const [users] = await connection.query("SELECT * FROM `users`")
    for (const user of users) {
        const normalized = normalizeUserExperience(user)
        const requiredExp = calculateRequiredExp(normalized.level)
        const updates = {}

        if (normalized.current_exp !== user.current_exp) {
            updates.current_exp = normalized.current_exp
        }

        if (!user.required_exp || user.required_exp !== requiredExp) {
            updates.required_exp = requiredExp
        }

        if (Object.keys(updates).length) {
            await connection.query("UPDATE `users` SET ? WHERE `id` = ?", [updates, user.id])
        }
    }

    if (legacyExpColumn.length) {
        await dropColumnIfExists(connection, "users", "exp")
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
        logger.info("Experience column migration completed successfully", {
            scope: "migration",
            icon: "✅"
        })
    } catch (error) {
        logger.error("Failed to migrate experience columns", {
            scope: "migration",
            message: error.message,
            stack: error.stack
        })
        process.exitCode = 1
    } finally {
        await connection.end()
    }
}

migrate()
