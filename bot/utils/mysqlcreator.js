const { DEFAULT_PLAYER_LEVEL, calculateRequiredExp } = require("./experience")
const { info } = require("./logger")
const config = require("../../config")
const STARTING_REQUIRED_EXP = calculateRequiredExp(DEFAULT_PLAYER_LEVEL)
const MASTER_USER_ID = config?.discord?.ownerId || null

module.exports = async(pool) => {
    const connection = await pool.getConnection()
    try {
        const [usersTables] = await connection.query("SHOW TABLES LIKE ?", ["users"])

        if (!usersTables || usersTables.length === 0) {
            await connection.query(
                `CREATE TABLE \`users\` (
                    \`id\` VARCHAR(25) NOT NULL DEFAULT '',
                    \`money\` BIGINT UNSIGNED NOT NULL DEFAULT '5000',
                    \`gold\` BIGINT UNSIGNED NOT NULL DEFAULT '1',
                    \`current_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '0',
                    \`required_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '${STARTING_REQUIRED_EXP}',
                    \`level\` INT(5) UNSIGNED NOT NULL DEFAULT '${DEFAULT_PLAYER_LEVEL}',
                    \`hands_played\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`hands_won\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_won\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_bet\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`withholding_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`reward_amount_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`reward_time_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`bankroll_private\` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0',
                    \`next_reward\` TIMESTAMP DEFAULT NULL,
                    \`last_played\` TIMESTAMP DEFAULT NULL,
                    \`join_date\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`id\`)
                )`
            )
            info("Users table created", { scope: "mysql" })
        } else {
            // Add bankroll_private column if it doesn't exist (migration for existing tables)
            try {
                const [columns] = await connection.query(
                    "SHOW COLUMNS FROM `users` LIKE 'bankroll_private'"
                )
                if (!columns || columns.length === 0) {
                    await connection.query(
                        "ALTER TABLE `users` ADD COLUMN `bankroll_private` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0' AFTER `reward_time_upgrade`"
                    )
                    info("Added bankroll_private column to users table", { scope: "mysql" })
                }
            } catch (error) {
                info("bankroll_private column already exists or failed to add", { scope: "mysql" })
            }

            // Add join_date column if it doesn't exist (migration for existing tables)
            try {
                const [columns] = await connection.query(
                    "SHOW COLUMNS FROM `users` LIKE 'join_date'"
                )
                if (!columns || columns.length === 0) {
                    await connection.query(
                        "ALTER TABLE `users` ADD COLUMN `join_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `last_played`"
                    )
                    info("Added join_date column to users table", { scope: "mysql" })
                }
            } catch (error) {
                info("join_date column already exists or failed to add", { scope: "mysql" })
            }
        }

        const [logsTables] = await connection.query("SHOW TABLES LIKE ?", ["logs"])

        if (!logsTables || logsTables.length === 0) {
            await connection.query(
                `CREATE TABLE \`logs\` (
                    \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    \`level\` VARCHAR(20) NOT NULL,
                    \`message\` TEXT NOT NULL,
                    \`log_type\` ENUM('general', 'command') NOT NULL DEFAULT 'general',
                    \`user_id\` VARCHAR(25) DEFAULT NULL,
                    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    INDEX \`idx_type_date\` (\`log_type\`, \`created_at\` DESC),
                    INDEX \`idx_level_date\` (\`level\`, \`created_at\` DESC),
                    INDEX \`idx_user_date\` (\`user_id\`, \`created_at\` DESC)
                )`
            )
            info("Logs table created with optimized indexes", { scope: "mysql" })
        } else {
            // Add compound indexes if table exists but indexes don't
            try {
                await connection.query("CREATE INDEX idx_type_date ON logs(log_type, created_at DESC)")
                info("Added compound index idx_type_date to logs table", { scope: "mysql" })
            } catch (error) {
                // Index might already exist, ignore
                if (!error.message.includes("Duplicate key name")) {
                    info("Compound index idx_type_date already exists or failed to create", { scope: "mysql" })
                }
            }

            try {
                await connection.query("CREATE INDEX idx_level_date ON logs(level, created_at DESC)")
                info("Added compound index idx_level_date to logs table", { scope: "mysql" })
            } catch (error) {
                if (!error.message.includes("Duplicate key name")) {
                    info("Compound index idx_level_date already exists or failed to create", { scope: "mysql" })
                }
            }

            try {
                await connection.query("CREATE INDEX idx_user_date ON logs(user_id, created_at DESC)")
                info("Added compound index idx_user_date to logs table", { scope: "mysql" })
            } catch (error) {
                if (!error.message.includes("Duplicate key name")) {
                    info("Compound index idx_user_date already exists or failed to create", { scope: "mysql" })
                }
            }

            // Drop old single-column indexes if they exist
            try {
                await connection.query("DROP INDEX idx_created_at ON logs")
                info("Dropped old single-column index idx_created_at", { scope: "mysql" })
            } catch (error) {
                // Index might not exist, ignore
            }

            try {
                await connection.query("DROP INDEX idx_log_type ON logs")
                info("Dropped old single-column index idx_log_type", { scope: "mysql" })
            } catch (error) {
                // Index might not exist, ignore
            }
        }

        const [accessTables] = await connection.query("SHOW TABLES LIKE ?", ["user_access"])

        if (!accessTables || accessTables.length === 0) {
            await connection.query(
                `CREATE TABLE \`user_access\` (
                    \`user_id\` VARCHAR(25) NOT NULL,
                    \`role\` ENUM('MASTER','ADMIN','MODERATOR','USER') NOT NULL DEFAULT 'USER',
                    \`is_blacklisted\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                    \`is_whitelisted\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`user_id\`)
                )`
            )
            info("user_access table created", { scope: "mysql" })
        } else {
            const ensureColumn = async(column, definition) => {
                try {
                    const [columns] = await connection.query("SHOW COLUMNS FROM `user_access` LIKE ?", [column])
                    if (!columns || columns.length === 0) {
                        await connection.query(`ALTER TABLE \`user_access\` ADD COLUMN ${definition}`)
                        info(`Added ${column} column to user_access table`, { scope: "mysql" })
                    }
                } catch (error) {
                    info(`${column} column already exists or failed to add`, { scope: "mysql" })
                }
            }

            await ensureColumn("role", "`role` ENUM('MASTER','ADMIN','MODERATOR','USER') NOT NULL DEFAULT 'USER'")
            await ensureColumn("is_blacklisted", "`is_blacklisted` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0")
            await ensureColumn("is_whitelisted", "`is_whitelisted` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0")
            await ensureColumn(
                "created_at",
                "`created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
            )
            await ensureColumn(
                "updated_at",
                "`updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            )
        }

        if (MASTER_USER_ID) {
            await connection.query(
                `INSERT INTO \`user_access\` (\`user_id\`, \`role\`, \`is_whitelisted\`, \`is_blacklisted\`)
                VALUES (?, 'MASTER', 1, 0)
                ON DUPLICATE KEY UPDATE \`role\` = 'MASTER', \`is_whitelisted\` = 1, \`is_blacklisted\` = 0`,
                [MASTER_USER_ID]
            )
            info("Ensured master record exists in user_access table", { scope: "mysql" })
        }

        const [policiesTables] = await connection.query("SHOW TABLES LIKE ?", ["access_policies"])

        if (!policiesTables || policiesTables.length === 0) {
            await connection.query(
                `CREATE TABLE \`access_policies\` (
                    \`id\` TINYINT UNSIGNED NOT NULL DEFAULT 1,
                    \`enforce_whitelist\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                    \`enforce_blacklist\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
                    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (\`id\`)
                )`
            )
            info("access_policies table created", { scope: "mysql" })
        } else {
            try {
                const [columns] = await connection.query("SHOW COLUMNS FROM `access_policies` LIKE 'enforce_blacklist'")
                if (!columns || columns.length === 0) {
                    await connection.query("ALTER TABLE `access_policies` ADD COLUMN `enforce_blacklist` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1 AFTER `enforce_whitelist`")
                    info("Added enforce_blacklist column to access_policies table", { scope: "mysql" })
                }
            } catch (error) {
                info("enforce_blacklist column already exists or failed to add", { scope: "mysql" })
            }
        }

        await connection.query(
            `INSERT IGNORE INTO \`access_policies\` (\`id\`, \`enforce_whitelist\`, \`enforce_blacklist\`)
            VALUES (1, 0, 1)`
        )
        info("Ensured default access policy row exists", { scope: "mysql" })
    } finally {
        connection.release()
    }
}
