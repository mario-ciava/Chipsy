// NOTA: Deve corrispondere a constants.urls.botApiLocal
const DEFAULT_ORIGIN = "http://localhost:8082"

const normalizeOrigin = (value) => value.replace(/\/$/, "")

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
