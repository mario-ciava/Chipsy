const { normalizeUserExperience } = require("./experience")
const logger = require("./logger")

const createSetData = (dataHandler) => async(user) => {
    const createResult = ({ data = null, created = false, error = null }) => ({ data, created, error })

    if (!user || !user.id) {
        return createResult({
            error: {
                type: "invalid-user",
                message: "Invalid user passed to SetData."
            }
        })
    }

    if (user.bot || user.system) {
        return createResult({
            error: {
                type: "bot-user",
                message: "Bot accounts do not have persistent Chipsy data."
            }
        })
    }

    const assignData = (payload, created = false) => {
        const normalized = normalizeUserExperience(payload)
        user.data = normalized
        return createResult({ data: normalized, created })
    }

    let existing
    try {
        existing = await dataHandler.getUserData(user.id)
    } catch (error) {
        return createResult({
            error: {
                type: "database",
                message: "Failed to retrieve user data.",
                cause: error
            }
        })
    }

    if (existing) {
        return assignData(existing)
    }

    let created
    try {
        created = await dataHandler.createUserData(user.id)
    } catch (error) {
        if (error && error.code === "ER_DUP_ENTRY") {
            try {
                const concurrentData = await dataHandler.getUserData(user.id)
                if (concurrentData) {
                    return assignData(concurrentData)
                }
            } catch (retryError) {
                return createResult({
                    error: {
                        type: "database",
                        message: "Failed to retrieve user data.",
                        cause: retryError
                    }
                })
            }
        }

        return createResult({
            error: {
                type: "database",
                message: "Failed to create user data.",
                cause: error
            }
        })
    }

    if (!created) {
        return createResult({
            error: {
                type: "creation-failed",
                message: "Failed to initialize user data."
            }
        })
    }

    return assignData(created, true)
}

module.exports = createSetData
