const { DEFAULT_PLAYER_LEVEL, calculateRequiredExp } = require("../experience")
const logger = require("../logger")
const config = require("../../config")

const STARTING_REQUIRED_EXP = calculateRequiredExp(DEFAULT_PLAYER_LEVEL)
const MASTER_USER_ID = config?.discord?.ownerId || null
const DEFAULT_GUILD_STATUSES = ["pending", "approved", "discarded"]
const configuredGuildStatuses = config?.accessControl?.guilds?.statuses
const GUILD_STATUSES = configuredGuildStatuses
    ? Object.values(configuredGuildStatuses)
    : DEFAULT_GUILD_STATUSES
const GUILD_STATUS_ENUM = (GUILD_STATUSES.length ? GUILD_STATUSES : DEFAULT_GUILD_STATUSES)
    .map((status) => status.replace(/'/g, ""))
    .map((status) => `'${status}'`)
    .join(", ")

const logInfo = (message, meta = {}) => {
    logger.info(message, { scope: "mysql", ...meta })
}

const ensureUsersTable = async(connection) => {
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
                \`net_winnings\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                \`withholding_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                \`reward_amount_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                \`reward_time_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                \`win_probability_upgrade\` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0',
                \`bankroll_private\` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0',
                \`next_reward\` TIMESTAMP DEFAULT NULL,
                \`last_played\` TIMESTAMP DEFAULT NULL,
                \`join_date\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`)
            )`
        )
        logInfo("Users table created")
        return
    }

    const ensureColumn = async(column, definition) => {
        const [columns] = await connection.query("SHOW COLUMNS FROM `users` LIKE ?", [column])
        if (!columns || columns.length === 0) {
            await connection.query(`ALTER TABLE \`users\` ADD COLUMN ${definition}`)
            logInfo(`Added ${column} column to users table`)
        }
    }

    await ensureColumn(
        "net_winnings",
        "`net_winnings` BIGINT UNSIGNED NOT NULL DEFAULT '0' AFTER `biggest_bet`"
    )
    await ensureColumn(
        "win_probability_upgrade",
        "`win_probability_upgrade` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0' AFTER `reward_time_upgrade`"
    )
    await ensureColumn(
        "bankroll_private",
        "`bankroll_private` TINYINT(1) UNSIGNED NOT NULL DEFAULT '0' AFTER `win_probability_upgrade`"
    )
    await ensureColumn(
        "last_played",
        "`last_played` TIMESTAMP NULL DEFAULT NULL AFTER `next_reward`"
    )
    await ensureColumn(
        "join_date",
        "`join_date` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `last_played`"
    )
}

const ensureLogsTable = async(connection) => {
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
        logInfo("Logs table created with optimized indexes")
        return
    }

    const createIndexIfMissing = async(name, statement) => {
        try {
            await connection.query(statement)
            logInfo(`Added compound index ${name} to logs table`)
        } catch (error) {
            if (!error.message.includes("Duplicate key name")) {
                logInfo(`Compound index ${name} already exists or failed to create`)
            }
        }
    }

    await createIndexIfMissing("idx_type_date", "CREATE INDEX idx_type_date ON logs(log_type, created_at DESC)")
    await createIndexIfMissing("idx_level_date", "CREATE INDEX idx_level_date ON logs(level, created_at DESC)")
    await createIndexIfMissing("idx_user_date", "CREATE INDEX idx_user_date ON logs(user_id, created_at DESC)")

    try {
        await connection.query("ALTER TABLE `logs` DROP INDEX `idx_created_at`")
        logInfo("Dropped old single-column index idx_created_at")
    } catch (error) {
        // Index might already be gone; safe to ignore
    }

    try {
        await connection.query("ALTER TABLE `logs` DROP INDEX `idx_log_type`")
        logInfo("Dropped old single-column index idx_log_type")
    } catch (error) {
        // Also safe to ignore if missing
    }
}

const ensureUserAccessTable = async(connection) => {
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
        logInfo("user_access table created")
    } else {
        const ensureColumn = async(column, definition) => {
            const [columns] = await connection.query("SHOW COLUMNS FROM `user_access` LIKE ?", [column])
            if (!columns || columns.length === 0) {
                await connection.query(`ALTER TABLE \`user_access\` ADD COLUMN ${definition}`)
                logInfo(`Added ${column} column to user_access table`)
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
        logInfo("Ensured master record exists in user_access table")
    }
}

const ensureAccessPoliciesTable = async(connection) => {
    const [policyTables] = await connection.query("SHOW TABLES LIKE ?", ["access_policies"])

    if (!policyTables || policyTables.length === 0) {
        await connection.query(
            `CREATE TABLE \`access_policies\` (
                \`id\` TINYINT UNSIGNED NOT NULL DEFAULT 1,
                \`enforce_whitelist\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                \`enforce_blacklist\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1,
                \`enforce_quarantine\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`id\`)
            )`
        )
        logInfo("access_policies table created")
    } else {
        const [columns] = await connection.query("SHOW COLUMNS FROM `access_policies` LIKE 'enforce_blacklist'")
        if (!columns || columns.length === 0) {
            await connection.query(
                "ALTER TABLE `access_policies` ADD COLUMN `enforce_blacklist` TINYINT(1) UNSIGNED NOT NULL DEFAULT 1 AFTER `enforce_whitelist`"
            )
            logInfo("Added enforce_blacklist column to access_policies table")
        }
        const [quarantineColumn] = await connection.query("SHOW COLUMNS FROM `access_policies` LIKE 'enforce_quarantine'")
        if (!quarantineColumn || quarantineColumn.length === 0) {
            await connection.query(
                "ALTER TABLE `access_policies` ADD COLUMN `enforce_quarantine` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0 AFTER `enforce_blacklist`"
            )
            logInfo("Added enforce_quarantine column to access_policies table")
        }
    }

    await connection.query(
        `INSERT INTO \`access_policies\` (\`id\`, \`enforce_whitelist\`, \`enforce_blacklist\`, \`enforce_quarantine\`)
        VALUES (1, 0, 1, 0)
        ON DUPLICATE KEY UPDATE
            \`enforce_whitelist\` = VALUES(\`enforce_whitelist\`),
            \`enforce_blacklist\` = VALUES(\`enforce_blacklist\`),
            \`enforce_quarantine\` = VALUES(\`enforce_quarantine\`)`
    )
    logInfo("Ensured default access policy row exists")
}

const ensureGuildQuarantineTable = async(connection) => {
    const [tables] = await connection.query("SHOW TABLES LIKE ?", ["guild_quarantine"])

    if (!tables || tables.length === 0) {
        await connection.query(
            `CREATE TABLE \`guild_quarantine\` (
                \`guild_id\` VARCHAR(25) NOT NULL,
                \`name\` VARCHAR(200) DEFAULT NULL,
                \`owner_id\` VARCHAR(25) DEFAULT NULL,
                \`member_count\` INT UNSIGNED DEFAULT NULL,
                \`status\` ENUM(${GUILD_STATUS_ENUM}) NOT NULL DEFAULT 'pending',
                \`approved_by\` VARCHAR(25) DEFAULT NULL,
                \`approved_at\` TIMESTAMP NULL DEFAULT NULL,
                \`discarded_by\` VARCHAR(25) DEFAULT NULL,
                \`discarded_at\` TIMESTAMP NULL DEFAULT NULL,
                \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`guild_id\`),
                KEY \`idx_status_updated_at\` (\`status\`, \`updated_at\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        )
        logInfo("guild_quarantine table created")
        return
    }

    const ensureColumn = async(column, definition) => {
        const [columns] = await connection.query("SHOW COLUMNS FROM `guild_quarantine` LIKE ?", [column])
        if (!columns || columns.length === 0) {
            await connection.query(`ALTER TABLE \`guild_quarantine\` ADD COLUMN ${definition}`)
            logInfo(`Added ${column} column to guild_quarantine table`)
        }
    }

    await ensureColumn("owner_id", "`owner_id` VARCHAR(25) DEFAULT NULL AFTER `name`")
    await ensureColumn("member_count", "`member_count` INT UNSIGNED DEFAULT NULL AFTER `owner_id`")
    await ensureColumn("approved_by", "`approved_by` VARCHAR(25) DEFAULT NULL AFTER `status`")
    await ensureColumn("approved_at", "`approved_at` TIMESTAMP NULL DEFAULT NULL AFTER `approved_by`")
    await ensureColumn("discarded_by", "`discarded_by` VARCHAR(25) DEFAULT NULL AFTER `approved_at`")
    await ensureColumn("discarded_at", "`discarded_at` TIMESTAMP NULL DEFAULT NULL AFTER `discarded_by`")

    const ensureIndex = async(name, statement) => {
        try {
            await connection.query(statement)
            logInfo(`Ensured index ${name} on guild_quarantine`)
        } catch (error) {
            if (!error.message.includes("Duplicate key name")) {
                logInfo(`Failed to create index ${name} on guild_quarantine`, { error: error.message })
            }
        }
    }

    await ensureIndex(
        "idx_status_updated_at",
        "CREATE INDEX idx_status_updated_at ON `guild_quarantine`(`status`, `updated_at` DESC)"
    )
}

const ensureLeaderboardCacheTable = async(connection) => {
    const tableName = "leaderboard_cache"
    const [tables] = await connection.query("SHOW TABLES LIKE ?", [tableName])

    if (!tables || tables.length === 0) {
        await connection.query(
            `CREATE TABLE \`leaderboard_cache\` (
                \`metric\` VARCHAR(32) NOT NULL,
                \`user_id\` VARCHAR(25) NOT NULL,
                \`score\` DECIMAL(32,6) NOT NULL DEFAULT 0,
                \`money\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`gold\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`current_exp\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`required_exp\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`level\` INT UNSIGNED NOT NULL DEFAULT 1,
                \`hands_played\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`hands_won\` BIGINT UNSIGNED NOT NULL DEFAULT 0,
                \`net_winnings\` BIGINT NOT NULL DEFAULT 0,
                \`win_rate\` DECIMAL(10,6) NOT NULL DEFAULT 0,
                \`last_played\` TIMESTAMP NULL DEFAULT NULL,
                \`join_date\` TIMESTAMP NULL DEFAULT NULL,
                \`bankroll_private\` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0,
                \`trend_direction\` TINYINT NOT NULL DEFAULT 0,
                \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (\`metric\`, \`user_id\`),
                INDEX \`idx_metric_score\` (\`metric\`, \`score\` DESC, \`hands_played\` DESC, \`money\` DESC),
                INDEX \`idx_metric_activity\` (\`metric\`, \`last_played\` DESC),
                INDEX \`idx_user_metric\` (\`user_id\`, \`metric\`),
                INDEX \`idx_user_search\` (\`user_id\`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        )
        logInfo("leaderboard_cache table created")
        return
    }

    const ensureColumn = async(column, definition) => {
        const [columns] = await connection.query("SHOW COLUMNS FROM `leaderboard_cache` LIKE ?", [column])
        if (!columns || columns.length === 0) {
            await connection.query(`ALTER TABLE \`leaderboard_cache\` ADD COLUMN ${definition}`)
            logInfo(`Added ${column} column to leaderboard_cache table`)
        }
    }

    await ensureColumn("bankroll_private", "`bankroll_private` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0 AFTER `join_date`")
    await ensureColumn("trend_direction", "`trend_direction` TINYINT NOT NULL DEFAULT 0 AFTER `bankroll_private`")

    const ensureIndex = async(name, statement) => {
        try {
            await connection.query(statement)
            logInfo(`Ensured index ${name} on leaderboard_cache`)
        } catch (error) {
            if (!error.message.includes("Duplicate key name")) {
                logInfo(`Failed to create index ${name} on leaderboard_cache`)
            }
        }
    }

    await ensureIndex(
        "idx_metric_score",
        "CREATE INDEX idx_metric_score ON `leaderboard_cache`(`metric`, `score` DESC, `hands_played` DESC, `money` DESC)"
    )
    await ensureIndex(
        "idx_metric_activity",
        "CREATE INDEX idx_metric_activity ON `leaderboard_cache`(`metric`, `last_played` DESC)"
    )
    await ensureIndex(
        "idx_user_metric",
        "CREATE INDEX idx_user_metric ON `leaderboard_cache`(`user_id`, `metric`)"
    )
    await ensureIndex(
        "idx_user_search",
        "CREATE INDEX idx_user_search ON `leaderboard_cache`(`user_id`)"
    )
}

const ensureSchema = async(pool) => {
    const connection = await pool.getConnection()
    try {
        await ensureUsersTable(connection)
        await ensureLogsTable(connection)
        await ensureUserAccessTable(connection)
        await ensureAccessPoliciesTable(connection)
        await ensureGuildQuarantineTable(connection)
        await ensureLeaderboardCacheTable(connection)
    } finally {
        connection.release()
    }
}

module.exports = ensureSchema
