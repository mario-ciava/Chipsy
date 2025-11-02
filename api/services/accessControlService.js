const logger = require("../../shared/logger")
const config = require("../../config")

const ROLES = {
    MASTER: "MASTER",
    ADMIN: "ADMIN",
    MODERATOR: "MODERATOR",
    USER: "USER"
}

const ROLE_VALUES = Object.values(ROLES)
const DEFAULT_GUILD_STATUSES = {
    pending: "pending",
    approved: "approved",
    discarded: "discarded"
}
const guildStatusConfig = config?.accessControl?.guilds?.statuses || DEFAULT_GUILD_STATUSES
const GUILD_STATUSES = {
    pending: guildStatusConfig.pending || DEFAULT_GUILD_STATUSES.pending,
    approved: guildStatusConfig.approved || DEFAULT_GUILD_STATUSES.approved,
    discarded: guildStatusConfig.discarded || DEFAULT_GUILD_STATUSES.discarded
}
const GUILD_STATUS_VALUES = Object.values(GUILD_STATUSES)
const GUILD_TABLE = "guild_quarantine"
const guildNameMaxLength = Number(config?.accessControl?.guilds?.metadata?.nameMaxLength) || 200

const normalizeRole = (value, fallback = ROLES.USER) => {
    if (!value) return fallback
    const normalized = String(value).trim().toUpperCase()
    return ROLE_VALUES.includes(normalized) ? normalized : fallback
}

const buildPermissionMatrix = (role) => {
    const normalized = normalizeRole(role)
    const isMaster = normalized === ROLES.MASTER
    const isPanelAdmin = isMaster || normalized === ROLES.ADMIN
    const isModerator = normalized === ROLES.MODERATOR || isPanelAdmin

    return {
        role: normalized,
        isMaster,
        isAdmin: isPanelAdmin,
        isModerator,
        canAccessPanel: isPanelAdmin,
        canViewLogs: isModerator,
        canManageRoles: isPanelAdmin,
        canAssignAdmin: isMaster,
        canAssignModerator: isPanelAdmin,
        canManageLists: isPanelAdmin,
        canWriteLogs: isPanelAdmin
    }
}

const normalizeGuildStatus = (value, fallback = null) => {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
    if (normalized && GUILD_STATUS_VALUES.includes(normalized)) {
        return normalized
    }
    return fallback
}

const sanitizeGuildName = (value) => {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed) return null
    return trimmed.slice(0, guildNameMaxLength)
}

const normalizeMemberCount = (value) => {
    if (value === null || value === undefined) return null
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null
    }
    return Math.min(parsed, 10_000_000)
}

const POLICY_DEFAULT = Object.freeze({
    enforceWhitelist: false,
    enforceBlacklist: true,
    enforceQuarantine: false,
    updatedAt: null
})

const POLICY_ROW_ID = 1
const POLICY_CACHE_TTL_MS = 10_000

const createAccessControlService = ({
    pool,
    ownerId,
    logger: providedLogger = logger
}) => {
    if (!pool) {
        throw new Error("MySQL pool is required to create the access control service")
    }

    const log = providedLogger || console

    const runQuery = async(query, params = [], context = {}) => {
        try {
            const [rows] = await pool.query(query, params)
            return rows
        } catch (error) {
            log.error?.("Access control query failed", {
                scope: "access-control",
                operation: context.operation,
                userId: context.userId,
                message: error.message
            })
            throw error
        }
    }

    const ensurePolicyRow = async() => {
        await runQuery(
            `INSERT IGNORE INTO \`access_policies\` (\`id\`, \`enforce_whitelist\`, \`enforce_blacklist\`, \`enforce_quarantine\`)
             VALUES (?, 0, 1, 0)`,
            [POLICY_ROW_ID],
            { operation: "ensurePolicyRow" }
        )
    }

    const ensureMasterRecord = async() => {
        if (!ownerId) return null
        return runQuery(
            `INSERT INTO \`user_access\` (\`user_id\`, \`role\`, \`is_whitelisted\`, \`is_blacklisted\`)
            VALUES (?, 'MASTER', 1, 0)
            ON DUPLICATE KEY UPDATE \`role\` = 'MASTER', \`is_whitelisted\` = 1, \`is_blacklisted\` = 0`,
            [ownerId],
            { operation: "ensureMasterRecord", userId: ownerId }
        )
    }

    const mapRowToRecord = (row) => {
        if (!row) return null
        return {
            userId: row.user_id,
            role: normalizeRole(row.role),
            isBlacklisted: Boolean(row.is_blacklisted),
            isWhitelisted: Boolean(row.is_whitelisted),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            persisted: true
        }
    }

const mapPolicyRow = (row) => {
    if (!row) return { ...POLICY_DEFAULT }
    return {
        enforceWhitelist: Boolean(row.enforce_whitelist),
        enforceBlacklist: row.enforce_blacklist === undefined
            ? POLICY_DEFAULT.enforceBlacklist
            : Boolean(row.enforce_blacklist),
        enforceQuarantine: row.enforce_quarantine === undefined
            ? POLICY_DEFAULT.enforceQuarantine
            : Boolean(row.enforce_quarantine),
        updatedAt: row.updated_at || null
    }
}

const mapGuildRow = (row) => {
    if (!row) return null
    return {
        guildId: row.guild_id,
        name: row.name,
        ownerId: row.owner_id,
        memberCount: typeof row.member_count === "number" ? row.member_count : normalizeMemberCount(row.member_count),
        status: normalizeGuildStatus(row.status, GUILD_STATUSES.approved),
        approvedBy: row.approved_by || null,
        approvedAt: row.approved_at || null,
        discardedBy: row.discarded_by || null,
        discardedAt: row.discarded_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    }
}

    const buildDefaultRecord = (userId) => {
        if (!userId) return null
        const role = userId === ownerId ? ROLES.MASTER : ROLES.USER
        return {
            userId,
            role,
            isBlacklisted: false,
            isWhitelisted: userId === ownerId,
            createdAt: null,
            updatedAt: null,
            persisted: false
        }
    }

    const enforceOwnerInvariants = async(record) => {
        if (!record) return record
        if (record.userId !== ownerId) return record
        await ensureMasterRecord()
        return {
            ...record,
            role: ROLES.MASTER,
            isBlacklisted: false,
            isWhitelisted: true
        }
    }

    const ensureUserRow = async(userId, roleHint = ROLES.USER) => {
        if (!userId) return null
        const normalized = normalizeRole(roleHint)
        await runQuery(
            `INSERT IGNORE INTO \`user_access\` (\`user_id\`, \`role\`, \`is_blacklisted\`, \`is_whitelisted\`)
            VALUES (?, ?, 0, 0)`,
            [userId, normalized],
            { operation: "ensureUserRow", userId }
        )
    }

    const getGuildAccessRecord = async(guildId) => {
        if (!guildId) return null
        const rows = await runQuery(
            `SELECT * FROM \`${GUILD_TABLE}\` WHERE \`guild_id\` = ? LIMIT 1`,
            [guildId],
            { operation: "getGuildAccessRecord", guildId }
        )
        if (!rows.length) {
            return null
        }
        return mapGuildRow(rows[0])
    }

    const registerGuild = async({
        guildId,
        name,
        ownerId,
        memberCount
    } = {}, { policy: policyOverride } = {}) => {
        if (!guildId) return null
        const normalizedName = sanitizeGuildName(name)
        const normalizedOwner = ownerId ? String(ownerId) : null
        const normalizedMembers = normalizeMemberCount(memberCount)
        const policy = policyOverride || (await getAccessPolicy())
        const initialStatus = policy.enforceQuarantine ? GUILD_STATUSES.pending : GUILD_STATUSES.approved

        await runQuery(
            `INSERT INTO \`${GUILD_TABLE}\` (\`guild_id\`, \`name\`, \`owner_id\`, \`member_count\`, \`status\`)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                \`name\` = COALESCE(VALUES(\`name\`), \`name\`),
                \`owner_id\` = COALESCE(VALUES(\`owner_id\`), \`owner_id\`),
                \`member_count\` = COALESCE(VALUES(\`member_count\`), \`member_count\`)`,
            [guildId, normalizedName, normalizedOwner, normalizedMembers, initialStatus],
            { operation: "registerGuild", guildId }
        )

        return getGuildAccessRecord(guildId)
    }

    const registerGuilds = async(entries = []) => {
        if (!Array.isArray(entries) || !entries.length) {
            return []
        }
        const policy = await getAccessPolicy()
        const results = []
        for (const entry of entries) {
            try {
                const record = await registerGuild(entry, { policy })
                if (record) {
                    results.push(record)
                }
            } catch (error) {
                log.warn?.("Failed to register guild entry", {
                    scope: "access-control",
                    operation: "registerGuilds",
                    guildId: entry?.guildId,
                    message: error.message
                })
            }
        }
        return results
    }

    const listGuildEntries = async({ status } = {}) => {
        const normalizedStatus = normalizeGuildStatus(status)
        const filters = []
        const values = []
        if (normalizedStatus) {
            filters.push("`status` = ?")
            values.push(normalizedStatus)
        }

        const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
        const rows = await runQuery(
            `SELECT * FROM \`${GUILD_TABLE}\` ${whereClause} ORDER BY \`updated_at\` DESC`,
            values,
            { operation: "listGuildQuarantine" }
        )
        return rows.map((row) => mapGuildRow(row)).filter(Boolean)
    }

    const updateGuildStatus = async({ guildId, status, actorId }) => {
        if (!guildId) {
            throw Object.assign(new Error("Guild id is required."), { status: 400 })
        }
        const normalizedStatus = normalizeGuildStatus(status)
        if (!normalizedStatus) {
            throw Object.assign(new Error("Invalid guild status."), { status: 400 })
        }

        const assignments = ["`status` = ?"]
        const values = [normalizedStatus]

        if (normalizedStatus === GUILD_STATUSES.approved) {
            assignments.push("`approved_by` = ?")
            values.push(actorId || null)
            assignments.push("`approved_at` = ?")
            values.push(new Date())
            assignments.push("`discarded_by` = NULL", "`discarded_at` = NULL")
        } else if (normalizedStatus === GUILD_STATUSES.discarded) {
            assignments.push("`discarded_by` = ?")
            values.push(actorId || null)
            assignments.push("`discarded_at` = ?")
            values.push(new Date())
        }

        const result = await runQuery(
            `UPDATE \`${GUILD_TABLE}\` SET ${assignments.join(", ")} WHERE \`guild_id\` = ?`,
            [...values, guildId],
            { operation: "updateGuildStatus", guildId }
        )

        if (!result.affectedRows) {
            throw Object.assign(new Error("Guild not found."), { status: 404 })
        }

        return getGuildAccessRecord(guildId)
    }

    const approveGuild = async({ guildId, actorId }) => updateGuildStatus({
        guildId,
        actorId,
        status: GUILD_STATUSES.approved
    })

    const discardGuild = async({ guildId, actorId }) => updateGuildStatus({
        guildId,
        actorId,
        status: GUILD_STATUSES.discarded
    })

    const getAccessRecord = async(userId) => {
        if (!userId) return null
        if (userId === ownerId) {
            await ensureMasterRecord()
        }
        const rows = await runQuery(
            "SELECT * FROM `user_access` WHERE `user_id` = ? LIMIT 1",
            [userId],
            { operation: "getAccessRecord", userId }
        )
        if (!rows.length) {
            return buildDefaultRecord(userId)
        }
        const record = mapRowToRecord(rows[0])
        return enforceOwnerInvariants(record)
    }

    const getAccessRecords = async(userIds = []) => {
        if (!Array.isArray(userIds) || !userIds.length) {
            return new Map()
        }

        const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
        if (!uniqueIds.length) {
            return new Map()
        }

        const rows = await runQuery(
            `SELECT * FROM \`user_access\`
             WHERE \`user_id\` IN (${uniqueIds.map(() => "?").join(",")})`,
            uniqueIds,
            { operation: "getAccessRecords" }
        )

        const map = new Map()
        rows.forEach((row) => {
            map.set(row.user_id, mapRowToRecord(row))
        })

        uniqueIds.forEach((id) => {
            if (!map.has(id)) {
                map.set(id, buildDefaultRecord(id))
            }
        })

        if (ownerId && map.has(ownerId)) {
            map.set(ownerId, {
                ...map.get(ownerId),
                role: ROLES.MASTER,
                isBlacklisted: false,
                isWhitelisted: true
            })
        }

        return map
    }

    const ensureCanAssignRole = (actorRole, targetRecord, nextRole, actorId, targetId) => {
        const normalizedActorRole = normalizeRole(actorRole)
        const normalizedTargetRole = normalizeRole(targetRecord?.role)
        const normalizedNextRole = normalizeRole(nextRole)

        if (targetId === ownerId) {
            if (normalizedNextRole !== ROLES.MASTER) {
                throw Object.assign(new Error("The master role cannot be reassigned."), { status: 403 })
            }
            return
        }

        if (normalizedNextRole === ROLES.MASTER) {
            throw Object.assign(new Error("Only the configured owner can retain the master role."), { status: 403 })
        }

        const permissions = buildPermissionMatrix(normalizedActorRole)
        if (!permissions.canManageRoles) {
            throw Object.assign(new Error("Missing permissions to manage roles."), { status: 403 })
        }

        if (normalizedNextRole === ROLES.ADMIN && !permissions.canAssignAdmin) {
            throw Object.assign(new Error("Only the master can assign admin roles."), { status: 403 })
        }

        if (normalizedTargetRole === ROLES.ADMIN && !permissions.canAssignAdmin) {
            throw Object.assign(new Error("Only the master can modify admin roles."), { status: 403 })
        }

        if (normalizedTargetRole === ROLES.MASTER && actorId !== ownerId) {
            throw Object.assign(new Error("Only the owner can modify the master role."), { status: 403 })
        }

        if (!permissions.canAssignModerator && normalizedNextRole === ROLES.MODERATOR) {
            throw Object.assign(new Error("Missing permissions to manage moderator roles."), { status: 403 })
        }

        if (actorId === targetId && normalizedActorRole === ROLES.MASTER && normalizedNextRole !== ROLES.MASTER) {
            throw Object.assign(new Error("The master role cannot be removed from the owner."), { status: 400 })
        }
    }

    const resolveActorRole = async(actorId, fallbackRole) => {
        if (!actorId) return normalizeRole(fallbackRole)
        const actorRecord = await getAccessRecord(actorId)
        return normalizeRole(actorRecord?.role || fallbackRole)
    }

    const setRole = async({
        actorId,
        actorRole,
        targetId,
        nextRole
    }) => {
        const targetRecord = await getAccessRecord(targetId)
        const effectiveActorRole = await resolveActorRole(actorId, actorRole)
        ensureCanAssignRole(effectiveActorRole, targetRecord, nextRole, actorId, targetId)

        await ensureUserRow(targetId, targetRecord?.role)

        await runQuery(
            "UPDATE `user_access` SET `role` = ? WHERE `user_id` = ?",
            [normalizeRole(nextRole), targetId],
            { operation: "setRole", userId: targetId }
        )

        return getAccessRecord(targetId)
    }

    const ensureListPermissions = (actorRole, targetId) => {
        const permissions = buildPermissionMatrix(actorRole)
        if (!permissions.canManageLists) {
            throw Object.assign(new Error("Missing permissions to manage access lists."), { status: 403 })
        }
        if (targetId === ownerId) {
            throw Object.assign(new Error("The master cannot be listed."), { status: 400 })
        }
    }

    const updateLists = async({
        actorId,
        actorRole,
        targetId,
        isBlacklisted,
        isWhitelisted
    }) => {
        const effectiveRole = await resolveActorRole(actorId, actorRole)
        ensureListPermissions(effectiveRole, targetId)

        let targetRecord = await getAccessRecord(targetId)
        await ensureUserRow(targetId, targetRecord?.role)
        targetRecord = targetRecord || (await getAccessRecord(targetId))

        const targetRole = normalizeRole(targetRecord?.role)
        const isPrivilegedTarget = [ROLES.MASTER, ROLES.ADMIN, ROLES.MODERATOR].includes(targetRole)

        if (isBlacklisted === true && (targetId === ownerId || isPrivilegedTarget)) {
            throw Object.assign(new Error("Privileged users cannot be blacklisted."), { status: 400 })
        }

        const updates = {}
        if (typeof isBlacklisted === "boolean") {
            updates.is_blacklisted = isBlacklisted ? 1 : 0
            if (isBlacklisted) {
                updates.is_whitelisted = 0
            }
        }
        if (typeof isWhitelisted === "boolean") {
            updates.is_whitelisted = isWhitelisted ? 1 : 0
            if (isWhitelisted) {
                updates.is_blacklisted = 0
            }
        }

        if (!Object.keys(updates).length) {
            return getAccessRecord(targetId)
        }

        const setClause = Object.keys(updates)
            .map((column) => `\`${column}\` = ?`)
            .join(", ")
        const values = [...Object.values(updates), targetId]

        await runQuery(
            `UPDATE \`user_access\` SET ${setClause} WHERE \`user_id\` = ?`,
            values,
            { operation: "updateLists", userId: targetId }
        )

        return getAccessRecord(targetId)
    }

    let cachedPolicy = null
    let cachedPolicyExpiry = 0

    const getAccessPolicy = async({ forceRefresh = false } = {}) => {
        const now = Date.now()
        if (!forceRefresh && cachedPolicy && cachedPolicyExpiry > now) {
            return cachedPolicy
        }

        await ensurePolicyRow()
        const rows = await runQuery(
            "SELECT * FROM `access_policies` WHERE `id` = ? LIMIT 1",
            [POLICY_ROW_ID],
            { operation: "getAccessPolicy" }
        )

        const policy = mapPolicyRow(rows?.[0])
        cachedPolicy = policy
        cachedPolicyExpiry = now + POLICY_CACHE_TTL_MS
        return policy
    }

    const setAccessPolicy = async({ enforceWhitelist, enforceBlacklist, enforceQuarantine }) => {
        const updates = {}
        if (typeof enforceWhitelist === "boolean") {
            updates.enforce_whitelist = enforceWhitelist ? 1 : 0
        }
        if (typeof enforceBlacklist === "boolean") {
            updates.enforce_blacklist = enforceBlacklist ? 1 : 0
        }
        if (typeof enforceQuarantine === "boolean") {
            updates.enforce_quarantine = enforceQuarantine ? 1 : 0
        }
        if (!Object.keys(updates).length) {
            throw new Error("No policy updates specified.")
        }
        await ensurePolicyRow()
        const setClause = Object.keys(updates)
            .map((column) => `\`${column}\` = ?`)
            .join(", ")
        const values = [...Object.values(updates), POLICY_ROW_ID]
        await runQuery(
            `UPDATE \`access_policies\` SET ${setClause} WHERE \`id\` = ?`,
            values,
            { operation: "setAccessPolicy" }
        )
        cachedPolicy = null
        cachedPolicyExpiry = 0
        const nextPolicy = await getAccessPolicy({ forceRefresh: true })
        log.info?.("Access policy updated", {
            scope: "access-control",
            policy: nextPolicy
        })
        return nextPolicy
    }

    const setWhitelistEnforcement = async(enforceWhitelist) => setAccessPolicy({ enforceWhitelist })

    const setBlacklistEnforcement = async(enforceBlacklist) => setAccessPolicy({ enforceBlacklist })
    const setQuarantineEnforcement = async(enforceQuarantine) => setAccessPolicy({ enforceQuarantine })

    const listAccessEntries = async({ list }) => {
        const normalized = typeof list === "string" ? list.trim().toLowerCase() : ""
        const column = normalized === "whitelist" ? "is_whitelisted" : normalized === "blacklist" ? "is_blacklisted" : null
        if (!column) {
            throw new Error("Invalid list requested.")
        }
        const rows = await runQuery(
            `SELECT * FROM \`user_access\` WHERE \`${column}\` = 1 ORDER BY \`updated_at\` DESC`,
            [],
            { operation: "listAccessEntries" }
        )
        return rows.map((row) => mapRowToRecord(row)).filter(Boolean)
    }

    const evaluateGuildAccess = async(guildId, { policy, context } = {}) => {
        if (!guildId) {
            return { allowed: true, policy }
        }
        const resolvedPolicy = policy || (await getAccessPolicy())
        if (!resolvedPolicy.enforceQuarantine) {
            return { allowed: true, policy: resolvedPolicy }
        }

        let guildRecord = await getGuildAccessRecord(guildId)
        if (!guildRecord) {
            try {
                guildRecord = await registerGuild({
                    guildId,
                    name: context?.guildName,
                    ownerId: context?.ownerId,
                    memberCount: context?.memberCount
                }, { policy: resolvedPolicy })
            } catch (error) {
                log.warn?.("Failed to register guild during access evaluation", {
                    scope: "access-control",
                    operation: "evaluateGuildAccess",
                    guildId,
                    message: error.message
                })
            }
        }

        if (!guildRecord || guildRecord.status !== GUILD_STATUSES.approved) {
            return {
                allowed: false,
                reason: "guild-quarantine",
                guild: guildRecord,
                policy: resolvedPolicy
            }
        }

        return {
            allowed: true,
            guild: guildRecord,
            policy: resolvedPolicy
        }
    }

    const evaluateBotAccess = async(userId, context = {}) => {
        const record = await getAccessRecord(userId)
        const policy = await getAccessPolicy()
        const permissions = buildPermissionMatrix(record?.role)

        if (policy.enforceBlacklist && record?.isBlacklisted && record.userId !== ownerId) {
            return {
                allowed: false,
                reason: "blacklisted",
                record,
                policy
            }
        }

        if (
            policy.enforceWhitelist
            && !record?.isWhitelisted
            && !permissions.canAccessPanel
        ) {
            return {
                allowed: false,
                reason: "whitelist",
                record,
                policy
            }
        }

        if (policy.enforceQuarantine && context.guildId) {
            const guildResult = await evaluateGuildAccess(context.guildId, {
                policy,
                context: {
                    guildName: context.guildName,
                    ownerId: context.guildOwnerId,
                    memberCount: context.guildMemberCount
                }
            })
            if (!guildResult.allowed) {
                return {
                    allowed: false,
                    reason: "guild-quarantine",
                    record,
                    policy,
                    guild: guildResult.guild
                }
            }
        }

        return {
            allowed: true,
            record,
            policy
        }
    }

    return {
        getAccessRecord,
        getAccessRecords,
        setRole,
        updateLists,
        buildDefaultRecord,
        ensureMasterRecord,
        getAccessPolicy,
        setWhitelistEnforcement,
        setBlacklistEnforcement,
        setQuarantineEnforcement,
        setAccessPolicy,
        listAccessEntries,
        evaluateBotAccess,
        registerGuild,
        registerGuilds,
        listGuildEntries,
        approveGuild,
        discardGuild,
        evaluateGuildAccess
    }
}

module.exports = {
    createAccessControlService,
    ROLES,
    buildPermissionMatrix
}
