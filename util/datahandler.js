const createDataHandler = (connection) => {
    const getUserData = (id) => {
        return new Promise((resolve, reject) => {
            if (!id) return reject(new Error("User id is required."))
            connection.query("SELECT * FROM `users` WHERE `id` = ?", id, (err, results) => {
                if (err) return reject(err)
                if (results.length > 0) return resolve(results[0])
                resolve(null)
            })
        })
    }

    const createUserData = (id) => {
        return new Promise((resolve, reject) => {
            if (!id) return reject(new Error("User id is required."))
            connection.query("INSERT INTO `users` SET `id` = ?", id, (err) => {
                if (err) return reject(err)
                getUserData(id).then(resolve).catch(reject)
            })
        })
    }

    const updateUserData = (id, user) => {
        return new Promise((resolve, reject) => {
            if (!id) return reject(new Error("User id is required."))
            connection.query("UPDATE `users` SET ? WHERE `id` = ?", [user, id], (err) => {
                if (err) return reject(err)
                getUserData(id).then(resolve).catch(reject)
            })
        })
    }

    const resolveDBUser = (user) => ({
        money: user.data.money,
        gold: user.data.gold,
        current_exp: user.data.current_exp,
        required_exp: user.data.required_exp,
        level: user.data.level,
        hands_played: user.data.hands_played,
        hands_won: user.data.hands_won,
        biggest_won: user.data.biggest_won,
        biggest_bet: user.data.biggest_bet,
        withholding_upgrade: user.data.withholding_upgrade,
        reward_amount_upgrade: user.data.reward_amount_upgrade,
        reward_time_upgrade: user.data.reward_time_upgrade,
        next_reward: user.data.next_reward,
        last_played: user.data.last_played || new Date()
    })

    return {
        getUserData,
        createUserData,
        updateUserData,
        resolveDBUser
    }
}

module.exports = createDataHandler
