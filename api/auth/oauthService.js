const crypto = require("crypto")

const TRUSTED_PROTOCOLS = new Set(["http:", "https:"])

const normalizeOrigin = (value = "") => value.replace(/\/$/, "")

const createOAuthService = ({
    discordApi,
    clientCredentials,
    scopes,
    defaultRedirectUri,
    allowedRedirectOrigins = [],
    logger
}) => {
    const allowedOrigins = new Set(
        [defaultRedirectUri, ...allowedRedirectOrigins]
            .filter(Boolean)
            .map(normalizeOrigin)
    )

    const sanitizeRedirectUri = (candidate) => {
        if (!candidate || typeof candidate !== "string") {
            return normalizeOrigin(defaultRedirectUri)
        }
        try {
            const parsed = new URL(candidate)
            if (!TRUSTED_PROTOCOLS.has(parsed.protocol)) {
                return normalizeOrigin(defaultRedirectUri)
            }
            const normalized = normalizeOrigin(parsed.origin)
            if (!allowedOrigins.has(normalized)) {
                return normalizeOrigin(defaultRedirectUri)
            }
            return normalized
        } catch (error) {
            return normalizeOrigin(defaultRedirectUri)
        }
    }

    const resolveRedirectUri = (candidate) => sanitizeRedirectUri(candidate)

    const generateState = (req) => {
        if (!req.session) {
            throw new Error("Session is required to generate OAuth state")
        }
        const state = crypto.randomBytes(24).toString("hex")
        req.session.oauthState = {
            value: state,
            issuedAt: Date.now()
        }
        return state
    }

    const validateState = (req, providedState) => {
        if (!req.session?.oauthState) {
            return false
        }
        const { value, issuedAt } = req.session.oauthState
        delete req.session.oauthState

        if (!providedState || typeof providedState !== "string") {
            return false
        }
        const maxAgeMs = 10 * 60 * 1000
        if (Date.now() - issuedAt > maxAgeMs) {
            return false
        }
        return providedState === value
    }

    const exchangeCode = async({ code, redirectUri }) => {
        if (!code) {
            throw new Error("Authorization code is required")
        }

        const params = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            scope: scopes.join(" ")
        })

        const response = await discordApi.post("/oauth2/token", params.toString(), {
            headers: {
                Authorization: `Basic ${clientCredentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        })

        return response.data
    }

    return {
        resolveRedirectUri,
        generateState,
        validateState,
        exchangeCode
    }
}

module.exports = createOAuthService
