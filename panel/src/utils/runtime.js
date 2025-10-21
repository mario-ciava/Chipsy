// NOTA: Deve corrispondere a constants.urls.botApiLocal
const DEFAULT_ORIGIN = "http://localhost:8082"
const LOGIN_RETURN_KEY = "chipsy:returnRoute"

const normalizeOrigin = (value) => value.replace(/\/$/, "")

const safeSessionStorage = () => {
    if (typeof window === "undefined" || !window.sessionStorage) {
        return null
    }
    try {
        return window.sessionStorage
    } catch (error) {
        return null
    }
}

export const getRuntimeOrigin = () => {
    const configured = (process.env.VUE_APP_DISCORD_REDIRECT || "").trim()

    if (typeof window !== "undefined" && window.location && window.location.origin) {
        const runtimeOrigin = window.location.origin

        if (configured.length === 0) {
            return normalizeOrigin(runtimeOrigin)
        }

        const normalizedConfigured = normalizeOrigin(configured)
        const normalizedRuntime = normalizeOrigin(runtimeOrigin)

        if (normalizedConfigured !== normalizedRuntime && process.env.NODE_ENV !== "production") {
            return normalizedRuntime
        }

        return normalizedConfigured
    }

    return configured.length > 0 ? normalizeOrigin(configured) : normalizeOrigin(DEFAULT_ORIGIN)
}

export const getControlPanelRedirect = () => `${getRuntimeOrigin()}/control_panel`

export const rememberPostLoginRoute = (route = "/") => {
    const storage = safeSessionStorage()
    if (!storage) return
    try {
        const target = typeof route === "string" && route.trim().length > 0 ? route : "/"
        storage.setItem(LOGIN_RETURN_KEY, target)
    } catch (error) {
        // ignore storage errors
    }
}

export const consumePostLoginRoute = (fallback = "/") => {
    const storage = safeSessionStorage()
    if (!storage) return fallback
    try {
        const target = storage.getItem(LOGIN_RETURN_KEY)
        if (target) {
            storage.removeItem(LOGIN_RETURN_KEY)
            return target
        }
    } catch (error) {
        return fallback
    }
    return fallback
}

export const getInviteRedirectTarget = () => {
    const explicit = (process.env.VUE_APP_DISCORD_INVITE_REDIRECT || "").trim()
    if (explicit.length > 0) {
        return explicit
    }
    const loginRedirect = (process.env.VUE_APP_DISCORD_REDIRECT || "").trim()
    if (loginRedirect.length > 0) {
        return loginRedirect
    }
    return getControlPanelRedirect()
}
