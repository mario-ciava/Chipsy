const express = require("express")

const createUsersRouter = (dependencies) => {
    const {
        client,
        getAccessToken
    } = dependencies

    const router = express.Router()

    const ensureAdminWithData = (req, res) => {
        if (!getAccessToken(req)) {
            res.status(400).json({ message: "400: Bad request" })
            return false
        }
        if (!req.isAdmin) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        if (!client.dataHandler || typeof client.dataHandler.listUsers !== "function") {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const resolveUsername = async(id) => {
        if (!id) return null
        const cached = client.users?.cache?.get?.(id)
        if (cached) {
            return cached.tag ?? (cached.username && cached.discriminator ? `${cached.username}#${cached.discriminator}` : cached.username) ?? null
        }

        if (typeof client.users?.fetch !== "function") return null

        try {
            const fetched = await client.users.fetch(id)
            if (!fetched) return null
            return fetched.tag ?? (fetched.username && fetched.discriminator ? `${fetched.username}#${fetched.discriminator}` : fetched.username) ?? null
        } catch (error) {
            if (client?.logger?.warn) {
                client.logger.warn("Failed to resolve username", {
                    scope: "express",
                    operation: "resolveUsername",
                    userId: id,
                    message: error.message
                })
            }
            return null
        }
    }

    const toUserSummary = async(user) => {
        if (!user) return null
        const handsPlayed = Number(user.hands_played || 0)
        const handsWon = Number(user.hands_won || 0)
        const winRate = handsPlayed > 0 ? Number(((handsWon / handsPlayed) * 100).toFixed(2)) : 0

        return {
            id: user.id,
            username: await resolveUsername(user.id),
            money: user.money,
            gold: user.gold,
            level: user.level,
            currentExp: user.current_exp,
            requiredExp: user.required_exp,
            handsPlayed,
            handsWon,
            winRate,
            biggestWon: user.biggest_won,
            biggestBet: user.biggest_bet,
            withholdingUpgrade: user.withholding_upgrade,
            rewardAmountUpgrade: user.reward_amount_upgrade,
            rewardTimeUpgrade: user.reward_time_upgrade,
            nextReward: user.next_reward,
            lastPlayed: user.last_played
        }
    }

    router.get("/", async(req, res, next) => {
        if (!ensureAdminWithData(req, res)) return
        const { page, pageSize, search } = req.query || {}

        try {
            const result = await client.dataHandler.listUsers({
                page,
                pageSize,
                search
            })

            res.status(200).json({
                items: await Promise.all(result.items.map((item) => toUserSummary(item))),
                pagination: result.pagination
            })
        } catch (error) {
            next(error)
        }
    })

    router.get("/:id", async(req, res, next) => {
        if (!ensureAdminWithData(req, res)) return
        const userId = req.params.id

        if (!userId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const user = await client.dataHandler.getUserData(userId)
            if (!user) {
                return res.status(404).json({ message: "404: User not found" })
            }

            res.status(200).json(await toUserSummary(user))
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createUsersRouter
