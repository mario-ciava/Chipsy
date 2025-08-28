const { logger } = require("./structuredLogger")

class AppError extends Error {
    constructor(message, statusCode, code = "INTERNAL_ERROR", details = null) {
        super(message)
        this.statusCode = statusCode
        this.code = code
        this.details = details
        this.isOperational = true

        Error.captureStackTrace(this, this.constructor)
    }
}

class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400, "VALIDATION_ERROR", details)
    }
}

class AuthenticationError extends AppError {
    constructor(message = "Authentication required") {
        super(message, 401, "AUTHENTICATION_ERROR")
    }
}

class AuthorizationError extends AppError {
    constructor(message = "Insufficient permissions") {
        super(message, 403, "AUTHORIZATION_ERROR")
    }
}

class NotFoundError extends AppError {
    constructor(resource = "Resource") {
        super(`${resource} not found`, 404, "NOT_FOUND")
    }
}

class ConflictError extends AppError {
    constructor(message) {
        super(message, 409, "CONFLICT")
    }
}

class DatabaseError extends AppError {
    constructor(message = "Database operation failed", details = null) {
        super(message, 500, "DATABASE_ERROR", details)
    }
}

class ExternalServiceError extends AppError {
    constructor(service, message = "External service unavailable") {
        super(message, 503, "SERVICE_UNAVAILABLE", { service })
    }
}

const errorHandler = (err, req, res, next) => {
    // Default to 500 if not specified
    let statusCode = err.statusCode || 500
    let code = err.code || "INTERNAL_ERROR"
    let message = err.message || "An unexpected error occurred"
    let details = err.details || null

    // Handle specific error types
    if (err.name === "CastError") {
        statusCode = 400
        code = "INVALID_ID"
        message = "Invalid ID format"
    }

    if (err.name === "JsonWebTokenError") {
        statusCode = 401
        code = "INVALID_TOKEN"
        message = "Invalid authentication token"
    }

    if (err.name === "TokenExpiredError") {
        statusCode = 401
        code = "TOKEN_EXPIRED"
        message = "Authentication token has expired"
    }

    if (err.code === "ECONNREFUSED") {
        statusCode = 503
        code = "SERVICE_UNAVAILABLE"
        message = "Unable to connect to required service"
    }

    // MySQL errors
    if (err.code === "ER_DUP_ENTRY") {
        statusCode = 409
        code = "DUPLICATE_ENTRY"
        message = "Resource already exists"
    }

    if (err.code === "ER_NO_REFERENCED_ROW") {
        statusCode = 400
        code = "INVALID_REFERENCE"
        message = "Referenced resource does not exist"
    }

    // Log error
    const logLevel = statusCode >= 500 ? "error" : "warn"
    logger[logLevel]("Request error", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode,
        code,
        message,
        stack: err.stack,
        userId: req.user?.id || null,
        ip: req.ip || req.connection.remoteAddress,
        isOperational: err.isOperational || false
    })

    // Don't leak sensitive error details in production
    const isDevelopment = process.env.NODE_ENV !== "production"
    const responseMessage = statusCode >= 500 && !isDevelopment
        ? "An internal error occurred. Please try again later."
        : message

    const responseDetails = statusCode >= 500 && !isDevelopment
        ? null
        : details

    const stack = isDevelopment ? err.stack : undefined

    // Send response in legacy format for frontend compatibility
    // Only include debug details in development
    const responsePayload = {
        message: `${statusCode}: ${responseMessage}`
    }

    if (responseDetails && isDevelopment) {
        responsePayload.details = responseDetails
    }

    if (stack && isDevelopment) {
        responsePayload.stack = stack
    }

    res.status(statusCode).json(responsePayload)
}

// Handle 404 routes
const notFoundHandler = (req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path}`))
}

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
}

module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    DatabaseError,
    ExternalServiceError,
    errorHandler,
    notFoundHandler,
    asyncHandler
}
