module.exports = async(connection, dbName) => {
    let output = await new Promise(async(resolve, reject) => {
        await connection.query("SHOW DATABASES LIKE ?", dbName, async(err, result, fields) => {
            if (err) reject(err)
            if (result && result.length < 1) {
                await connection.query("CREATE DATABASE ??", dbName)
                console.info("Database created!")
            }
            await connection.query("USE ??", dbName, (err) => {
                if (err) console.error(err)
            })
            await connection.query("SHOW TABLES LIKE ?", "users", async(err, result, fields) => {
                if (err) reject(err)
                if (result && result.length < 1) {
                    await connection.query("CREATE TABLE `users` (`id` VARCHAR(25) NOT NULL DEFAULT '', `money` INT NOT NULL DEFAULT '5000', `gold` INT NOT NULL DEFAULT '1', `exp` INT(10) unsigned NOT NULL DEFAULT '0', `level` INT(5) unsigned NOT NULL DEFAULT '0', `hands_played` INT unsigned NOT NULL DEFAULT '0', `hands_won` INT unsigned NOT NULL DEFAULT '0', `biggest_won` INT unsigned NOT NULL DEFAULT '0', `biggest_bet` INT unsigned NOT NULL DEFAULT '0', `withholding_upgrade` INT unsigned NOT NULL DEFAULT '0', `reward_amount_upgrade` INT unsigned NOT NULL DEFAULT '0', `reward_time_upgrade` INT unsigned NOT NULL DEFAULT '0', `next_reward` TIMESTAMP DEFAULT NULL, `last_played` TIMESTAMP DEFAULT NULL, PRIMARY KEY (`id`))", (err, result) => {
                        if (err) reject(err)
                        console.info("Users table created!")
                    })
                } 
            })
            resolve(connection)
        })
        /*await connection.query(`USE ${dbName}`)
        await connection.query("CREATE TABLE `users` IF NOT EXISTS (`id` VARCHAR(25) NOT NULL DEFAULT NULL, `money` INT NOT NULL DEFAULT '0', `level` INT(5) unsigned NOT NULL DEFAULT '0', `last_played` DATE DEFAULT NULL, PRIMARY KEY (`id`))", (err, result) => {
            if (err) reject(err)
            resolve(connection)
        })
        //await connection.query("CREATE TABLE `sessions` IF NOT EXISTS (`id` VARCHAR(8) NOT NULL DEFAULT NULL, `betting` VARCHAR(8) NOT NULL DEFAULT 'null', `timeout` TIMESTAMP DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, `creator` VARCHAR(25) NOT NULL DEFAULT NULL, PRIMARY KEY (`id`))")
        */
    })
    return output
}