const { normalizeUserExperience } = require("./experience")

const createSetData = (dataHandler) => async(user) => {
    if (!user || !user.id) throw new Error("Invalid user passed to SetData.")

    const existing = await dataHandler.getUserData(user.id)
    if (existing) {
        const normalized = normalizeUserExperience(existing)
        user.data = normalized
        return normalized
    }

    const created = await dataHandler.createUserData(user.id)
    if (!created) throw new Error("Failed to initialize user data.")
    const normalized = normalizeUserExperience(created)
    user.data = normalized
    return normalized
}

module.exports = createSetData
