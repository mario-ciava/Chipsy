module.exports = async (msg) => {
    if (msg.author.bot) return

    msg.prefix = msg.content.split(" ")[0].slice(0, msg.client.config.prefix.length)
    msg.command = msg.content.split(" ")[0].slice(msg.client.config.prefix.length)
    msg.params = msg.content.split(" ").slice(1)

    if (!msg.content.startsWith(msg.prefix)) return

    let cmd = msg.client.commands.find((command) => {
        return command.config.name == msg.command
    })

    if (!cmd) return
    if (cmd.config.params.length > msg.params.length) return

    await msg.client.SetData(msg.author)
        .catch(() => {
            return msg.channel.send(
                new Discord.RichEmbed()
                    .setColor("RED")
                    .setFooter(`${msg.author.tag}, error: cannot retrieve data from database`, msg.author.avatarURL)
            )
        })
    if (msg.author.data) cmd.run(msg)
}