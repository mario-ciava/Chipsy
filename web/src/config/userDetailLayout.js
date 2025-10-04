import userDetailLayout from "../../../config/userDetailLayout"

const overviewSections = Array.isArray(userDetailLayout?.overviewSections)
    ? userDetailLayout.overviewSections
    : []

export const USER_DETAIL_OVERVIEW = Object.freeze(overviewSections)

export default Object.freeze({
    overviewSections: USER_DETAIL_OVERVIEW
})
