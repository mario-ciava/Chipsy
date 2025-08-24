const logger = require("./logger")
const { buildCommandContext, CommandUserError } = require("./commandContext")

const createCommand = ({
    name,
    description,
    aliases = [],
    dmPermission = false,
    slashCommand,
    defer,
    deferEphemeral,
    defaultMemberPermissions,
    nsfw,
    errorMessage = "An unexpected error occurred while executing this command. Please try again later.",
    execute
}) => {
    if (!name || typeof name !== "string") {
        throw new Error("createCommand requires a valid 'name'.")
    }
    if (!description || typeof description !== "string") {
        throw new Error(`createCommand '${name}' requires a valid 'description'.`)
    }
    if (!slashCommand || typeof slashCommand.toJSON !== "function") {
        throw new Error(`createCommand '${name}' requires a valid 'slashCommand' builder.`)
    }
    if (typeof execute !== "function") {
        throw new Error(`createCommand '${name}' requires an 'execute' handler.`)
    }

    const config = {
        name,
        aliases,
        description,
        dmPermission,
        slashCommand
    }

    if (typeof defer === "boolean") config.defer = defer
    if (typeof deferEphemeral === "boolean") config.deferEphemeral = deferEphemeral
    if (defaultMemberPermissions !== undefined) config.defaultMemberPermissions = defaultMemberPermissions
    if (typeof nsfw === "boolean") config.nsfw = nsfw

    const run = async(payload) => {
        const message = payload?.message ?? null
        const interaction = payload?.interaction ?? null
        const client =
            payload?.client ??
            message?.client ??
            interaction?.client ??
            null
        const args =
            payload?.args ??
            message?.params ??
            []

        const context = buildCommandContext({
            commandName: name,
            message,
            interaction,
            client,
            args,
            logger
        })

        if (context.client?.config?.enabled === false) {
            const disabledMessage = "The bot is currently disabled by the administrators. Please try again later."

            if (context.interaction) {
                if (context.interaction.deferred && !context.interaction.replied) {
                    await context.safeInvoke(context.followUp, {
                        content: disabledMessage,
                        ephemeral: true
                    })
                } else if (!context.interaction.replied) {
                    await context.safeInvoke(context.reply, {
                        content: disabledMessage,
                        ephemeral: true
                    })
                }
            } else if (context.message) {
                await context.safeInvoke(context.reply, { content: disabledMessage })
            }

            return
        }

        try {
            await execute(context)
        } catch (error) {
            if (error instanceof CommandUserError) {
                if (error.log) {
                    logger.warn("Command rejected with user error", {
                        scope: "commands",
                        command: name,
                        userId: context.author?.id,
                        channelId: context.channel?.id,
                        message: error.message
                    })
                }

                if (error.payload) {
                    await context.replyError(error.userMessage, {
                        payload: error.payload,
                        ephemeral: error.ephemeral
                    })
                    return
                }

                await context.replyError(error.userMessage, {
                    embed: error.embed,
                    ephemeral: error.ephemeral
                })
                return
            }

            logger.error("Command execution failed", {
                scope: "commands",
                command: name,
                userId: context.author?.id,
                channelId: context.channel?.id,
                error: error.message,
                stack: error.stack
            })

            await context.replyError(errorMessage)
        }
    }

    return {
        config,
        run
    }
}

module.exports = createCommand
