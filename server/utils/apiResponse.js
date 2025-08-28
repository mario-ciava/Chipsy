/**
 * Standard API Response Utilities
 * Ensures consistent response format across all endpoints
 *
 * NOTE: Currently not in use to maintain backward compatibility with frontend.
 * The existing frontend expects legacy format: { message: "...", data: {...} }
 * These utilities implement a standardized format: { success: bool, data, error, meta }
 *
 * Ready for future migration when frontend is updated to handle the new format.
 * Until then, all endpoints use legacy format for consistency.
 */

const createResponse = (success, data, error, meta) => ({
    success,
    data: data || null,
    error: error || null,
    meta: {
        timestamp: new Date().toISOString(),
        ...meta
    }
})

/**
 * Success response
 * @param {object} res - Express response object
 * @param {*} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {object} meta - Additional metadata
 */
const sendSuccess = (res, data = null, statusCode = 200, meta = {}) => {
    const response = createResponse(true, data, null, {
        requestId: res.req?.requestId,
        ...meta
    })

    return res.status(statusCode).json(response)
}

/**
 * Created response (201)
 * @param {object} res - Express response object
 * @param {*} data - Created resource data
 * @param {object} meta - Additional metadata
 */
const sendCreated = (res, data, meta = {}) => {
    return sendSuccess(res, data, 201, meta)
}

/**
 * No content response (204)
 * @param {object} res - Express response object
 */
const sendNoContent = (res) => {
    return res.status(204).send()
}

/**
 * Paginated response
 * @param {object} res - Express response object
 * @param {Array} items - Array of items
 * @param {object} pagination - Pagination info
 */
const sendPaginated = (res, items, pagination) => {
    const { page, pageSize, total, totalPages } = pagination

    return sendSuccess(res, items, 200, {
        requestId: res.req?.requestId,
        pagination: {
            page,
            pageSize,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1
        }
    })
}

/**
 * Error response (handled by error middleware, but can be used for explicit errors)
 * @param {object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Error code
 * @param {*} details - Additional error details
 */
const sendError = (res, message, statusCode = 500, code = "INTERNAL_ERROR", details = null) => {
    const response = createResponse(false, null, {
        code,
        message,
        details
    }, {
        requestId: res.req?.requestId
    })

    return res.status(statusCode).json(response)
}

/**
 * Validation error response
 * @param {object} res - Express response object
 * @param {Array} errors - Validation errors
 */
const sendValidationError = (res, errors) => {
    return sendError(
        res,
        "Validation failed",
        400,
        "VALIDATION_ERROR",
        errors
    )
}

/**
 * Not found response
 * @param {object} res - Express response object
 * @param {string} resource - Resource name
 */
const sendNotFound = (res, resource = "Resource") => {
    return sendError(
        res,
        `${resource} not found`,
        404,
        "NOT_FOUND"
    )
}

/**
 * Unauthorized response
 * @param {object} res - Express response object
 * @param {string} message - Custom message
 */
const sendUnauthorized = (res, message = "Authentication required") => {
    return sendError(
        res,
        message,
        401,
        "UNAUTHORIZED"
    )
}

/**
 * Forbidden response
 * @param {object} res - Express response object
 * @param {string} message - Custom message
 */
const sendForbidden = (res, message = "Access denied") => {
    return sendError(
        res,
        message,
        403,
        "FORBIDDEN"
    )
}

/**
 * Conflict response
 * @param {object} res - Express response object
 * @param {string} message - Conflict message
 */
const sendConflict = (res, message) => {
    return sendError(
        res,
        message,
        409,
        "CONFLICT"
    )
}

/**
 * Service unavailable response
 * @param {object} res - Express response object
 * @param {string} service - Service name
 */
const sendServiceUnavailable = (res, service = "Service") => {
    return sendError(
        res,
        `${service} is currently unavailable`,
        503,
        "SERVICE_UNAVAILABLE"
    )
}

module.exports = {
    sendSuccess,
    sendCreated,
    sendNoContent,
    sendPaginated,
    sendError,
    sendValidationError,
    sendNotFound,
    sendUnauthorized,
    sendForbidden,
    sendConflict,
    sendServiceUnavailable
}
