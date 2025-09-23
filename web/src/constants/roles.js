export const PANEL_ROLES = {
    MASTER: {
        value: "MASTER",
        label: "Master",
        description: "Full ownership control. Can assign every role and manage system-wide settings."
    },
    ADMIN: {
        value: "ADMIN",
        label: "Admin",
        description: "Control-panel access with the ability to manage moderators, roles, and lists."
    },
    MODERATOR: {
        value: "MODERATOR",
        label: "Moderator",
        description: "Read-only access to the log console. No write actions."
    },
    USER: {
        value: "USER",
        label: "User",
        description: "No panel access. Can still use the Discord bot."
    }
}

export const ROLE_ORDER = ["MASTER", "ADMIN", "MODERATOR", "USER"]

export const ROLE_OPTIONS = ROLE_ORDER.map((role) => ({
    value: PANEL_ROLES[role].value,
    label: PANEL_ROLES[role].label
}))

export const getRoleLabel = (role) => {
    const normalized = typeof role === "string" ? role.toUpperCase() : "USER"
    return PANEL_ROLES[normalized]?.label || PANEL_ROLES.USER.label
}

export const getRoleDescription = (role) => {
    const normalized = typeof role === "string" ? role.toUpperCase() : "USER"
    return PANEL_ROLES[normalized]?.description || PANEL_ROLES.USER.description
}
