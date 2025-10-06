const express = require("express")
const { ROLES } = require("../services/accessControlService")
const { userSchemas, validate } = require("../validation/schemas")
const { constants } = require("../../config")

const SESSION_EXPIRED_MESSAGE = constants.messages?.sessionExpired
    || "401: Session expired. Please log in again."

const createUsersRouter = (dependencies) => {
    const {
        client,
        getAccessToken,
        requireCsrfToken
    } = dependencies

    const router = express.Router()

    const ensureAuthenticated = (req, res) => {
        if (!getAccessToken(req)) {
            res.status(401).json({ message: SESSION_EXPIRED_MESSAGE })
            return false
        }
        return true
    }

    const ensurePanelAccess = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canAccessPanel) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        if (!client.dataHandler || typeof client.dataHandler.listUsers !== "function") {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const ensureAccessControl = (res) => {
        if (!client.accessControl || typeof client.accessControl.getAccessRecord !== "function") {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const ensureRoleManagement = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canManageRoles) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        return ensureAccessControl(res)
    }

    const ensureListManagement = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canManageLists) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        return ensureAccessControl(res)
    }

    const ensureUserEditing = (req, res) => {
        if (!ensureAuthenticated(req, res)) return false
        if (!req.permissions?.canManageRoles) {
            res.status(403).json({ message: "403: Forbidden" })
            return false
        }
        if (!client.dataHandler
            || typeof client.dataHandler.getUserData !== "function"
            || typeof client.dataHandler.updateUserData !== "function"
        ) {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const buildAccessPayload = (userId, accessRecord) => {
        const ownerId = client.config?.ownerid
        const isOwner = ownerId && userId === ownerId

        const role = accessRecord?.role
            || (isOwner ? ROLES.MASTER : ROLES.USER)

        return {
            role,
            isBlacklisted: Boolean(accessRecord?.isBlacklisted),
            isWhitelisted: isOwner ? true : Boolean(accessRecord?.isWhitelisted),
            updatedAt: accessRecord?.updatedAt || null
        }
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

    const toUserSummary = async(user, accessRecord) => {
        if (!user) return null
        const handsPlayed = Number(user.hands_played || 0)
        const handsWon = Number(user.hands_won || 0)
        const winRate = handsPlayed > 0 ? Number(((handsWon / handsPlayed) * 100).toFixed(2)) : 0
        const accessPayload = buildAccessPayload(user.id, accessRecord)

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
            lastPlayed: user.last_played,
            panelRole: accessPayload.role,
            access: accessPayload
        }
    }

    const MAX_NAME_MATCHES = 50

    const collectNameCandidates = (userLike) => {
        if (!userLike) return []
        const source = userLike.user || userLike
        const values = [
            userLike.tag,
            userLike.username,
            userLike.globalName,
            userLike.displayName,
            userLike.nickname,
            source?.tag,
            source?.username,
            source?.globalName,
            source?.displayName
        ]

        if (source?.username && typeof source?.discriminator !== "undefined") {
            values.push(`${source.username}#${source.discriminator}`)
        }

        return values.filter(Boolean)
    }

    const lookupUserIdsByName = (query) => {
        if (!query || typeof query !== "string") return []
        const normalized = query.trim().toLowerCase()
        if (!normalized) return []

        const matches = new Set()

        const checkCandidate = (candidate) => {
            if (matches.size >= MAX_NAME_MATCHES) {
                return
            }
            if (!candidate) return
            const names = collectNameCandidates(candidate)
            const hasMatch = names.some((value) => typeof value === "string" && value.toLowerCase().includes(normalized))
            if (hasMatch) {
                const id = candidate.id || candidate.user?.id
                if (id) {
                    matches.add(id)
                }
            }
        }

        const visitCache = (cache, extractor = (entry) => entry) => {
            if (matches.size >= MAX_NAME_MATCHES || !cache) {
                return
            }
            if (typeof cache.values === "function") {
                for (const value of cache.values()) {
                    if (matches.size >= MAX_NAME_MATCHES) {
                        break
                    }
                    checkCandidate(extractor(value))
                }
                return
            }
            if (typeof cache.forEach === "function") {
                cache.forEach((value) => {
                    if (matches.size >= MAX_NAME_MATCHES) {
                        return
                    }
                    checkCandidate(extractor(value))
                })
                return
            }
            if (Array.isArray(cache)) {
                for (const value of cache) {
                    if (matches.size >= MAX_NAME_MATCHES) {
                        break
                    }
                    checkCandidate(extractor(value))
                }
            }
        }

        visitCache(client?.users?.cache)
        visitCache(client?.guilds?.cache, (guild) => {
            if (!guild?.members?.cache) return null
            const members = []
            guild.members.cache.forEach((member) => members.push(member))
            members.forEach((member) => {
                checkCandidate(member)
                if (member?.user) {
                    checkCandidate(member.user)
                }
            })
            return null
        })

        return Array.from(matches)
    }

    const activityToDays = (value) => {
        switch (value) {
            case "7d":
                return 7
            case "30d":
                return 30
            case "90d":
                return 90
            default:
                return null
        }
    }

    router.get("/", validate(userSchemas.listUsers, "query"), async(req, res, next) => {
        if (!ensurePanelAccess(req, res)) return
        const {
            page,
            pageSize,
            search,
            role,
            list,
            minLevel,
            maxLevel,
            minBalance,
            maxBalance,
            activity,
            sortBy,
            sortDirection
        } = req.query || {}

        try {
            const resolvedIds = search ? lookupUserIdsByName(search) : []
            const searchIds = resolvedIds.length ? resolvedIds : undefined

            const result = await client.dataHandler.listUsers({
                page,
                pageSize,
                search,
                userIds: searchIds,
                role,
                list: list === "all" ? undefined : list,
                minLevel,
                maxLevel,
                minBalance,
                maxBalance,
                activityDays: activityToDays(activity),
                sortBy,
                sortDirection
            })

            const ids = result.items.map((item) => item.id).filter(Boolean)
            let accessMap = new Map()
            if (ids.length && client.accessControl?.getAccessRecords) {
                accessMap = await client.accessControl.getAccessRecords(ids)
            }

            res.status(200).json({
                items: await Promise.all(result.items.map((item) => toUserSummary(item, accessMap.get(item.id)))),
                pagination: result.pagination
            })
        } catch (error) {
            next(error)
        }
    })

    router.get("/policy", async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        try {
            const policy = await client.accessControl.getAccessPolicy()
            res.status(200).json(policy)
        } catch (error) {
            next(error)
        }
    })

    router.patch("/policy", requireCsrfToken, async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        const { enforceWhitelist } = req.body || {}
        if (typeof enforceWhitelist !== "boolean") {
            return res.status(400).json({ message: "400: Bad request" })
        }
        try {
            const policy = await client.accessControl.setWhitelistEnforcement(enforceWhitelist)
            res.status(200).json(policy)
        } catch (error) {
            next(error)
        }
    })

    router.get("/:id", async(req, res, next) => {
        if (!ensurePanelAccess(req, res)) return
        const userId = req.params.id

        if (!userId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const user = await client.dataHandler.getUserData(userId)
            if (!user) {
                return res.status(404).json({ message: "404: User not found" })
            }

            let accessRecord = null
            if (client.accessControl?.getAccessRecord) {
                accessRecord = await client.accessControl.getAccessRecord(userId)
            }

            res.status(200).json(await toUserSummary(user, accessRecord))
        } catch (error) {
            next(error)
        }
    })

    router.patch("/:id/role", requireCsrfToken, async(req, res, next) => {
        if (!ensureRoleManagement(req, res)) return
        const userId = req.params.id
        const desiredRole = req.body?.role

        if (!userId || typeof desiredRole !== "string") {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const updated = await client.accessControl.setRole({
                actorId: req.user?.id,
                actorRole: req.user?.role,
                targetId: userId,
                nextRole: desiredRole
            })

            const access = buildAccessPayload(userId, updated)
            res.status(200).json({
                role: access.role,
                access
            })
        } catch (error) {
            if (error.status) {
                return res.status(error.status).json({ message: `${error.status}: ${error.message}` })
            }
            return next(error)
        }
    })

    router.patch("/:id/lists", requireCsrfToken, async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        const userId = req.params.id
        if (!userId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        const { isBlacklisted, isWhitelisted } = req.body || {}

        if (
            typeof isBlacklisted !== "boolean"
            && typeof isWhitelisted !== "boolean"
        ) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const updated = await client.accessControl.updateLists({
                actorId: req.user?.id,
                actorRole: req.user?.role,
                targetId: userId,
                isBlacklisted,
                isWhitelisted
            })

            const access = buildAccessPayload(userId, updated)
            res.status(200).json(access)
        } catch (error) {
            if (error.status) {
                return res.status(error.status).json({ message: `${error.status}: ${error.message}` })
            }
            return next(error)
        }
    })

    router.patch("/:id/stats", requireCsrfToken, validate(userSchemas.updateUserStats), async(req, res, next) => {
        if (!ensureUserEditing(req, res)) return
        const userId = req.params.id
        if (!userId) {
            return res.status(400).json({ message: "400: Bad request" })
        }

        try {
            const existing = await client.dataHandler.getUserData(userId)
            if (!existing) {
                return res.status(404).json({ message: "404: User not found" })
            }

            const { level, currentExp, money, gold } = req.body
            const updatePayload = {
                level,
                current_exp: currentExp,
                money,
                gold
            }

            const updated = await client.dataHandler.updateUserData(userId, updatePayload)
            let accessRecord = null
            if (client.accessControl?.getAccessRecord) {
                accessRecord = await client.accessControl.getAccessRecord(userId)
            }

            const summary = await toUserSummary(updated, accessRecord)
            res.status(200).json(summary)
        } catch (error) {
            next(error)
        }
    })

    return router
}

module.exports = createUsersRouter
