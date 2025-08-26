const { BASE_REQUIRED_EXP } = require("./experience")
const { info } = require("./logger")

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
                    \`required_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '${BASE_REQUIRED_EXP}',
                    \`level\` INT(5) UNSIGNED NOT NULL DEFAULT '0',
                    \`hands_played\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`hands_won\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_won\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_bet\` BIGINT UNSIGNED NOT NULL DEFAULT '0',
                    \`withholding_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`reward_amount_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`reward_time_upgrade\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`next_reward\` TIMESTAMP DEFAULT NULL,
                    \`last_played\` TIMESTAMP DEFAULT NULL,
                    PRIMARY KEY (\`id\`)
                )`
            )
            info("Users table created", { scope: "mysql" })
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
                    INDEX \`idx_created_at\` (\`created_at\`),
                    INDEX \`idx_log_type\` (\`log_type\`)
                )`
            )
            info("Logs table created", { scope: "mysql" })
        }
    } finally {
        connection.release()
    }
}
