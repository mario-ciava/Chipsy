const ROLES = {
    MASTER: "MASTER",
    ADMIN: "ADMIN",
    MODERATOR: "MODERATOR",
    USER: "USER"
}

const buildAccessPayload = ({
    userId,
    ownerId,
    accessRecord
}) => {
    const isOwner = ownerId && userId === ownerId
    const role = accessRecord?.role || (isOwner ? ROLES.MASTER : ROLES.USER)

    return {
        role,
        isBlacklisted: Boolean(accessRecord?.isBlacklisted),
        isWhitelisted: isOwner ? true : Boolean(accessRecord?.isWhitelisted),
        updatedAt: accessRecord?.updatedAt || null
    }
}

module.exports = {
    buildAccessPayload
}
