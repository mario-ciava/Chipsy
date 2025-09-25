const { z } = require("zod")
const sanitizeHtml = require("sanitize-html")

// Custom Zod validators
const sanitizedString = (maxLength = 1000) => z.string()
    .max(maxLength)
    .transform((val) => sanitizeHtml(val, {
        allowedTags: [],
        allowedAttributes: {}
    }))
    .refine((val) => val.trim().length > 0, {
        message: "String cannot be empty after sanitization"
    })

const discordSnowflake = z.string()
    .regex(/^\d{17,19}$/, "Invalid Discord ID format")

const logLevel = z.enum(["info", "success", "warning", "error", "debug", "system"])

const logType = z.enum(["general", "command"])

// Admin schemas
const adminSchemas = {
    toggleBot: z.object({
        enabled: z.boolean({
            required_error: "enabled field is required",
            invalid_type_error: "enabled must be a boolean"
        })
    }),

    leaveGuild: z.object({
        id: discordSnowflake
    }),

    completeInvite: z.object({
        code: z.string().min(1, "Invite code is required"),
        guildId: discordSnowflake.optional()
    }),

    createLog: z.object({
        level: logLevel,
        message: sanitizedString(5000),
        logType: logType.default("general"),
        userId: discordSnowflake.nullable().optional()
    }),

    getLogs: z.object({
        type: logType.default("general"),
        limit: z.coerce.number()
            .int()
            .min(1, "Limit must be at least 1")
            .max(500, "Limit cannot exceed 500")
            .default(100),
        cursor: z.string()
            .max(200)
            .optional()
            .refine((value) => {
                if (!value) return true
                try {
                    const decoded = Buffer.from(value, "base64").toString("utf8")
                    const payload = JSON.parse(decoded)
                    return Boolean(payload && payload.id && payload.createdAt)
                } catch (error) {
                    return false
                }
            }, { message: "Invalid cursor token" })
    }),

    tableAction: z.object({
        action: z.enum(["start", "pause", "resume", "stop"], {
            required_error: "Action is required"
        })
    }),

    tableActionParams: z.object({
        tableId: z.string()
            .min(4, "Invalid table id")
            .max(150, "Invalid table id")
    })
}

// User schemas
const userSchemas = {
    getUserById: z.object({
        id: discordSnowflake
    }),

    listUsers: z.object({
        page: z.coerce.number()
            .int()
            .min(1, "Page must be at least 1")
            .default(1),
        pageSize: z.coerce.number()
            .int()
            .min(1)
            .max(100, "Page size cannot exceed 100")
            .default(25),
        search: z.string()
            .max(100)
            .optional()
            .transform((val) => val ? sanitizeHtml(val, {
                allowedTags: [],
                allowedAttributes: {}
            }) : undefined)
    })
}

// Guild schemas
const guildSchemas = {
    getGuild: z.object({
        id: discordSnowflake
    })
}

// Auth schemas
const authSchemas = {
    exchangeCode: z.object({
        code: z.string()
            .min(20, "Invalid OAuth code")
            .max(50, "Invalid OAuth code")
    })
}

// Validation middleware factory
const validate = (schema, source = "body") => (req, res, next) => {
    try {
        const dataSource = source === "body" ? req.body :
                          source === "query" ? req.query :
                          source === "params" ? req.params :
                          req.body

        const result = schema.safeParse(dataSource)

        if (!result.success) {
            const errors = result.error.errors.map((err) => ({
                field: err.path.join("."),
                message: err.message
            }))

            // Use legacy format for frontend compatibility
            const errorMessage = errors.length === 1
                ? errors[0].message
                : "Invalid input data"

            return res.status(400).json({
                message: `400: ${errorMessage}`,
                errors // Include detailed errors for debugging
            })
        }

        // Replace original data with validated and sanitized data
        if (source === "body") req.body = result.data
        else if (source === "query") req.query = result.data
        else if (source === "params") req.params = result.data

        next()
    } catch (error) {
        next(error)
    }
}

module.exports = {
    adminSchemas,
    userSchemas,
    guildSchemas,
    authSchemas,
    validate
}
