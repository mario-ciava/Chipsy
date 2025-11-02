const express = require("express")
const { ROLES } = require("../services/accessControlService")
const { userSchemas, guildSchemas, validate } = require("../validation/schemas")
const { constants } = require("../../config")
const { buildAccessPayload } = require("../../shared/mappers/accessMapper")
const {
    createUserSummaryMapper,
    buildStatsUpdatePayload
} = require("../../shared/mappers/userMapper")

const SESSION_EXPIRED_MESSAGE = constants.messages?.sessionExpired
    || "401: Session expired. Please log in again."

const createUsersRouter = (dependencies) => {
    const {
        client,
        getAccessToken,
        requireCsrfToken,
        dataHandler = client?.dataHandler,
        accessControl = client?.accessControl,
        discordDirectory,
        ownerId: ownerIdOverride
    } = dependencies

    const router = express.Router()
    const resolvedOwnerId = ownerIdOverride || client.config?.ownerid

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
        if (!dataHandler || typeof dataHandler.listUsers !== "function") {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const ensureAccessControl = (res) => {
        if (!accessControl || typeof accessControl.getAccessRecord !== "function") {
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
        if (!dataHandler
            || typeof dataHandler.getUserData !== "function"
            || typeof dataHandler.updateUserData !== "function"
        ) {
            res.status(503).json({ message: "503: Service Unavailable" })
            return false
        }
        return true
    }

    const resolveUsernameFallback = async(id) => {
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

    const resolveUsername = async(id) => {
        if (discordDirectory?.resolveUsername) {
            return discordDirectory.resolveUsername(id)
        }
        return resolveUsernameFallback(id)
    }

    const mapUserSummary = createUserSummaryMapper({
        resolveUsername,
        ownerId: resolvedOwnerId,
        buildAccessPayload: ({ userId, accessRecord }) => buildAccessPayload({
            userId,
            ownerId: resolvedOwnerId,
            accessRecord
        })
    })

    const lookupUserIdsByName = async(query) => {
        if (!query || typeof query !== "string") {
            return []
        }
        if (discordDirectory?.lookupUserIdsByName) {
            try {
                return await discordDirectory.lookupUserIdsByName(query)
            } catch (error) {
                client?.logger?.warn?.("User lookup failed via directory", {
                    scope: "users",
                    query,
                    message: error.message
                })
            }
        }
        return []
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
            const resolvedIds = search ? await lookupUserIdsByName(search) : []
            const searchIds = resolvedIds.length ? resolvedIds : undefined

            const result = await dataHandler.listUsers({
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
            if (ids.length && accessControl?.getAccessRecords) {
                accessMap = await accessControl.getAccessRecords(ids)
            }

            res.status(200).json({
                items: await Promise.all(result.items.map((item) => mapUserSummary(item, accessMap.get(item.id)))),
                pagination: result.pagination
            })
        } catch (error) {
            next(error)
        }
    })

    router.get("/policy", async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        try {
            const policy = await accessControl.getAccessPolicy()
            res.status(200).json(policy)
        } catch (error) {
            next(error)
        }
    })

    router.patch("/policy", requireCsrfToken, async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        const { enforceWhitelist, enforceBlacklist, enforceQuarantine } = req.body || {}
        const hasWhitelist = typeof enforceWhitelist === "boolean"
        const hasBlacklist = typeof enforceBlacklist === "boolean"
        const hasQuarantine = typeof enforceQuarantine === "boolean"
        if (!hasWhitelist && !hasBlacklist && !hasQuarantine) {
            return res.status(400).json({ message: "400: Bad request" })
        }
        try {
            const policy = await accessControl.setAccessPolicy({
                enforceWhitelist,
                enforceBlacklist,
                enforceQuarantine
            })
            res.status(200).json(policy)
        } catch (error) {
            next(error)
        }
    })

    router.get("/lists", async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        const type = (req.query?.type || "").toString().toLowerCase()
        if (!["whitelist", "blacklist"].includes(type)) {
            return res.status(400).json({ message: "400: Invalid list type" })
        }
        try {
            const entries = await accessControl.listAccessEntries({ list: type })
            const enriched = await Promise.all(
                entries.map(async(entry) => ({
                    userId: entry.userId,
                    role: entry.role,
                    isBlacklisted: entry.isBlacklisted,
                    isWhitelisted: entry.isWhitelisted,
                    updatedAt: entry.updatedAt,
                    username: await resolveUsername(entry.userId)
                }))
            )
            res.status(200).json({ type, entries: enriched })
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
            const user = await dataHandler.getUserData(userId)
            if (!user) {
                return res.status(404).json({ message: "404: User not found" })
            }

            let accessRecord = null
            if (accessControl?.getAccessRecord) {
                accessRecord = await accessControl.getAccessRecord(userId)
            }

            res.status(200).json(await mapUserSummary(user, accessRecord))
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
            const updated = await accessControl.setRole({
                actorId: req.user?.id,
                actorRole: req.user?.role,
                targetId: userId,
                nextRole: desiredRole
            })

            const access = buildAccessPayload({
                userId,
                ownerId: resolvedOwnerId,
                accessRecord: updated
            })
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
            const updated = await accessControl.updateLists({
                actorId: req.user?.id,
                actorRole: req.user?.role,
                targetId: userId,
                isBlacklisted,
                isWhitelisted
            })

            const access = buildAccessPayload({
                userId,
                ownerId: resolvedOwnerId,
                accessRecord: updated
            })
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
            const existing = await dataHandler.getUserData(userId)
            if (!existing) {
                return res.status(404).json({ message: "404: User not found" })
            }

            const updatePayload = buildStatsUpdatePayload(req.body)

            const updated = await dataHandler.updateUserData(userId, updatePayload)
            let accessRecord = null
            if (accessControl?.getAccessRecord) {
                accessRecord = await accessControl.getAccessRecord(userId)
            }

            const summary = await mapUserSummary(updated, accessRecord)
            res.status(200).json(summary)
        } catch (error) {
            next(error)
        }
    })

    router.get("/guilds/quarantine", async(req, res, next) => {
        if (!ensureListManagement(req, res)) return
        const status = req.query?.status
        try {
            const entries = await accessControl.listGuildEntries({ status })
            res.status(200).json({ items: entries })
        } catch (error) {
            next(error)
        }
    })

    router.post(
        "/guilds/quarantine/:guildId/approve",
        validate(guildSchemas.quarantineActionParams, "params"),
        requireCsrfToken,
        async(req, res, next) => {
            if (!ensureListManagement(req, res)) return
            try {
                const record = await accessControl.approveGuild({
                    guildId: req.params.guildId,
                    actorId: req.user?.id
                })
                res.status(200).json(record)
            } catch (error) {
                next(error)
            }
        }
    )

    router.post(
        "/guilds/quarantine/:guildId/discard",
        validate(guildSchemas.quarantineActionParams, "params"),
        requireCsrfToken,
        async(req, res, next) => {
            if (!ensureListManagement(req, res)) return
            try {
                const record = await accessControl.discardGuild({
                    guildId: req.params.guildId,
                    actorId: req.user?.id
                })
                res.status(200).json(record)
            } catch (error) {
                next(error)
            }
        }
    )

    return router
}

module.exports = createUsersRouter
