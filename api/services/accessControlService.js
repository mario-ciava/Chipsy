const logger = require("../../shared/logger")

const ROLES = {
    MASTER: "MASTER",
    ADMIN: "ADMIN",
    MODERATOR: "MODERATOR",
    USER: "USER"
}

const ROLE_VALUES = Object.values(ROLES)

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

const POLICY_DEFAULT = Object.freeze({
    enforceWhitelist: false,
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
            "INSERT IGNORE INTO `access_policies` (`id`, `enforce_whitelist`) VALUES (?, 0)",
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

        const updates = {}
        if (typeof isBlacklisted === "boolean") {
            updates.is_blacklisted = isBlacklisted ? 1 : 0
        }
        if (typeof isWhitelisted === "boolean") {
            updates.is_whitelisted = isWhitelisted ? 1 : 0
        }

        if (!Object.keys(updates).length) {
            return getAccessRecord(targetId)
        }

        await ensureUserRow(targetId)

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

    const setWhitelistEnforcement = async(enforceWhitelist) => {
        const normalized = enforceWhitelist ? 1 : 0
        await ensurePolicyRow()
        await runQuery(
            "UPDATE `access_policies` SET `enforce_whitelist` = ? WHERE `id` = ?",
            [normalized, POLICY_ROW_ID],
            { operation: "setWhitelistEnforcement" }
        )
        cachedPolicy = null
        cachedPolicyExpiry = 0
        return getAccessPolicy({ forceRefresh: true })
    }

    const evaluateBotAccess = async(userId) => {
        const record = await getAccessRecord(userId)
        const policy = await getAccessPolicy()
        const permissions = buildPermissionMatrix(record?.role)

        if (record?.isBlacklisted && record.userId !== ownerId) {
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
        evaluateBotAccess
    }
}

module.exports = {
    createAccessControlService,
    ROLES,
    buildPermissionMatrix
}
