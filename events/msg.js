module.exports = async(msg) => {
    if (!msg.content || msg.author.bot) return

    const prefix = msg.client.config?.prefix
    if (!prefix || !msg.content.startsWith(prefix)) return

    if (msg.content.length <= prefix.length) return

    const withoutPrefix = msg.content.slice(prefix.length).trim()
    if (!withoutPrefix.length) return

    const [commandName, ...args] = withoutPrefix.split(/\s+/)

    msg.prefix = prefix
    msg.command = commandName.toLowerCase()
    msg.params = args.map((argument) => argument.trim()).filter(Boolean)

    await msg.client.commandRouter.handleMessage(msg)
}