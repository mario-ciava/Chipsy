const createSetData = (dataHandler) => async(user) => {
    if (!user || !user.id) throw new Error("Invalid user passed to SetData.")

    const existing = await dataHandler.getUserData(user.id)
    if (existing) {
        user.data = existing
        return existing
    }

    const created = await dataHandler.createUserData(user.id)
    if (!created) throw new Error("Failed to initialize user data.")
    user.data = created
    return created
}

module.exports = createSetData
