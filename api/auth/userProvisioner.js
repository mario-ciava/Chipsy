const createUserProvisioner = ({ dataHandler, panelConfig, logger }) => {
    const toPositiveInteger = (value, fallback) => {
        const numeric = Number(value)
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback
        }
        return Math.trunc(numeric)
    }

    const provisioningConfig = Object.freeze({
        enabled: panelConfig?.users?.profiles?.autoProvisionOnLogin !== false,
        retries: toPositiveInteger(panelConfig?.users?.profiles?.provisionRetryLimit, 2)
    })

    const ensureProfileProvisioned = async(userId) => {
        if (!userId || !dataHandler?.getUserData) {
            return { profile: null, created: false }
        }

        const readProfile = async() => {
            try {
                const record = await dataHandler.getUserData(userId)
                return { profile: record || null, error: null }
            } catch (error) {
                return { profile: null, error }
            }
        }

        const initial = await readProfile()
        if (initial.error) {
            return { profile: null, created: false, error: initial.error }
        }
        if (initial.profile) {
            return { profile: initial.profile, created: false }
        }

        if (!provisioningConfig.enabled || typeof dataHandler.createUserData !== "function") {
            return { profile: null, created: false }
        }

        const attempts = Math.max(1, provisioningConfig.retries)

        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const createdProfile = await dataHandler.createUserData(userId)
                return { profile: createdProfile, created: true }
            } catch (creationError) {
                if (creationError?.code === "ER_DUP_ENTRY") {
                    const retry = await readProfile()
                    if (retry.error) {
                        return { profile: null, created: false, error: retry.error }
                    }
                    if (retry.profile) {
                        return { profile: retry.profile, created: false }
                    }
                }

                if (attempt === attempts - 1) {
                    logger?.warn?.("Failed to auto-provision profile", {
                        scope: "auth",
                        userId,
                        message: creationError.message
                    })
                    return { profile: null, created: false, error: creationError }
                }
            }
        }

        return { profile: null, created: false }
    }

    return {
        ensureProfileProvisioned
    }
}

module.exports = createUserProvisioner
