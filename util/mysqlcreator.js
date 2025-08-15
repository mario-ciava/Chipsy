const { BASE_REQUIRED_EXP } = require("./experience")
const { info } = require("./logger")

module.exports = async(pool) => {
    const connection = await pool.getConnection()
    try {
        const [tables] = await connection.query("SHOW TABLES LIKE ?", ["users"])

        if (!tables || tables.length === 0) {
            await connection.query(
                `CREATE TABLE \`users\` (
                    \`id\` VARCHAR(25) NOT NULL DEFAULT '',
                    \`money\` INT NOT NULL DEFAULT '5000',
                    \`gold\` INT NOT NULL DEFAULT '1',
                    \`current_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '0',
                    \`required_exp\` INT(10) UNSIGNED NOT NULL DEFAULT '${BASE_REQUIRED_EXP}',
                    \`level\` INT(5) UNSIGNED NOT NULL DEFAULT '0',
                    \`hands_played\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`hands_won\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_won\` INT UNSIGNED NOT NULL DEFAULT '0',
                    \`biggest_bet\` INT UNSIGNED NOT NULL DEFAULT '0',
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
    } finally {
        connection.release()
    }
}
