#!/usr/bin/env node

const fs = require("fs")
const { spawn } = require("child_process")
const path = require("path")

const rootDir = path.resolve(__dirname, "..")

const commandOrder = ["mysql", "panel", "bot"]

const commandExists = (binary) => {
    if (!binary || typeof binary !== "string") return false
    const extensions = process.platform === "win32"
        ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
        : [""]
    const searchPaths = (process.env.PATH || "").split(path.delimiter).filter(Boolean)

    for (const searchPath of searchPaths) {
        for (const extension of extensions) {
            const candidate = path.join(searchPath, process.platform === "win32" ? `${binary}${extension}` : binary)
            if (!fs.existsSync(candidate)) continue

            if (process.platform === "win32") {
                return true
            }

            try {
                fs.accessSync(candidate, fs.constants.X_OK)
                return true
            } catch (error) {
                // Try next candidate
            }
        }
    }

    return false
}

const resolveMysqlCommand = () => {
    if (process.env.MYSQL_START_COMMAND) {
        return process.env.MYSQL_START_COMMAND
    }

    if (commandExists("docker")) {
        return "docker compose up mysql"
    }

    if (commandExists("docker-compose")) {
        return "docker-compose up mysql"
    }

    return null
}

const mysqlCommand = resolveMysqlCommand()
const mysqlSkipReason = (() => {
    if (process.env.SKIP_MYSQL === "1") {
        return "avvio MySQL saltato (SKIP_MYSQL=1)"
    }

    if (!mysqlCommand) {
        return "Docker CLI non rilevato. Salto l'avvio di MySQL. Installa Docker, imposta MYSQL_START_COMMAND o usa SKIP_MYSQL=1."
    }

    return null
})()

const commands = [
    {
        name: "mysql",
        command: mysqlCommand,
        optional: true,
        enabled: process.env.SKIP_MYSQL === "1" ? false : Boolean(mysqlCommand),
        skipMessage: mysqlSkipReason
    },
    {
        name: "panel",
        command: "npm --prefix web run serve",
        optional: false,
        enabled: true
    },
    {
        name: "bot",
        command: "node server/index.js",
        optional: false,
        enabled: true
    }
]

const activeProcesses = new Map()
const buffers = new Map()
const lastPrinted = new Map()

const formatLabel = (name) => `[${name}]`

const resolveStyle = () => {
    const value = (process.env.DEV_LOG_STYLE || "compact").toLowerCase()
    if (["compact", "minimal", "verbose"].includes(value)) return value
    return "compact"
}

const style = resolveStyle()
const verbose = process.env.DEV_LOG_VERBOSE === "1" || style === "verbose"
const showTimestamp = process.env.DEV_LOG_TIMESTAMP !== "0"

const COMPACT_SUPPRESSIONS = [
    /^<s>\s*\[webpack\.Progress]/i,
    /^webpack\.Progress/i,
    /^\d{1,3}%\s+building/i,
    /^ℹ /i,
    /^info\s+-/i,
    /^｢wds｣:/i,
    /^｢wdm｣:/i,
    /^wait/i,
    /^ready in /i,
    /^note that the development build/i
]

const MINIMAL_SUPPRESSIONS = [
    /hot module replacement/i,
    /^webpack/i,
    /^node:events/i,
    /^assets by chunk name/i,
    /^chunk\s+/i,
    /^asset\s+/i,
    /^cached modules/i,
    /^No issues found/i
]

const formatTime = () => {
    const iso = new Date().toISOString()
    return iso.substring(11, 19) // HH:MM:SS
}

const shouldSuppress = (line) => {
    if (verbose) return false
    if (COMPACT_SUPPRESSIONS.some((pattern) => pattern.test(line))) return true
    if (style === "minimal" && MINIMAL_SUPPRESSIONS.some((pattern) => pattern.test(line))) return true
    return false
}

const transformLine = (line) => {
    if (verbose) return [line]

    const trimmed = line.trim()

    if (/^App running at:?$/i.test(trimmed)) {
        return []
    }

    if (/^- Local:/i.test(trimmed)) {
        const value = trimmed.replace(/^- Local:\s*/i, "")
        return [`Dev server pronto → ${value}`]
    }

    if (/^- Network:/i.test(trimmed)) {
        if (style === "minimal") return []
        const value = trimmed.replace(/^- Network:\s*/i, "")
        return [`                    ↳ rete → ${value}`]
    }

    if (/^Note that the development build/i.test(trimmed)) {
        return []
    }

    if (/compiled successfully/i.test(trimmed)) {
        return [`Build ✓ ${trimmed.replace(/DONE\s+/i, "")}`]
    }

    if (/failed to compile/i.test(trimmed)) {
        return [`Build ✖ ${trimmed}`]
    }

    return [line]
}

const formatOutput = (name, message, type = "stdout") => {
    if (typeof message !== "string") return []
    const sanitized = message.replace(/\r?\n/g, "")
    if (sanitized.length === 0) return []
    const trimmed = sanitized.trim()

    if (shouldSuppress(trimmed)) {
        return []
    }

    return transformLine(sanitized)
}

const logLine = (name, message, type = "stdout") => {
    const lines = formatOutput(name, message, type)
    if (!lines.length) return

    for (const line of lines) {
        const isError = type === "stderr" || /(^|\s)(err(or)?|fail|✖|×)/i.test(line)
        const marker = isError ? "!" : " "
        const timestamp = showTimestamp ? `${formatTime()} ` : ""
        const output = `${timestamp}${formatLabel(name)} ${marker}${line}`
        const dedupKey = `${name}:${type}:${marker}`

        if (!verbose && lastPrinted.get(dedupKey) === output) {
            continue
        }

        lastPrinted.set(dedupKey, output)
        process.stdout.write(`${output}\n`)
    }
}

const spawnCommand = ({ name, command, optional }) => {
    const child = spawn(command, {
        cwd: rootDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true
    })

    activeProcesses.set(name, child)
    logLine(name, `avviato con comando: ${command}`)

    const pipeStream = (stream, streamType) => {
        if (!stream) return
        const bufferKey = `${name}:${streamType}`
        buffers.set(bufferKey, "")

        stream.on("data", (chunk) => {
            const previous = buffers.get(bufferKey) || ""
            const data = previous + chunk.toString()
            const lines = data.split(/\r?\n/)
            buffers.set(bufferKey, lines.pop() || "")
            for (const line of lines) {
                logLine(name, line, streamType)
            }
        })

        stream.on("end", () => {
            const remaining = buffers.get(bufferKey)
            if (remaining) {
                logLine(name, remaining, streamType)
            }
            buffers.delete(bufferKey)
        })
    }

    pipeStream(child.stdout, "stdout")
    pipeStream(child.stderr, "stderr")

    child.on("exit", (code, signal) => {
        activeProcesses.delete(name)
        const reason = signal ? `interrotto (${signal})` : `terminato con codice ${code}`
        logLine(name, reason)

        if (!optional && code !== 0) {
            logLine(name, "processo non opzionale terminato inaspettatamente.", "stderr")
        }
    })

    child.on("error", (error) => {
        logLine(name, `errore di avvio: ${error.message}`, "stderr")
        if (!optional) {
            process.exitCode = 1
        }
    })

    return child
}

const readyMatchers = {
    mysql: [/ready for connections/i, /mysqld:/i],
    panel: [/App running at/i, /Dev server pronto/i],
    bot: [/Discord client logged in/i, /Bootstrap started/i]
}

const waitForReady = (command, child) => new Promise((resolve) => {
    if (!child) return resolve()

    const patterns = readyMatchers[command.name] || null
    if (!patterns || patterns.length === 0) {
        return resolve()
    }

    let buffer = ""
    let resolved = false

    const cleanup = () => {
        if (resolved) return
        resolved = true
        child.stdout.removeListener("data", onData)
        child.removeListener("exit", onExit)
        resolve()
    }

    const onExit = () => cleanup()

    const matchLine = (line) => {
        return patterns.some((pattern) => pattern.test(line))
    }

    const onData = (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""
        for (const line of lines) {
            if (matchLine(line)) {
                cleanup()
                return
            }
        }
    }

    child.stdout.on("data", onData)
    child.on("exit", onExit)

    setTimeout(() => {
        if (!resolved) {
            cleanup()
        }
    }, 5000)
})

const shutdown = () => {
    logLine("dev-runner", "arresto dei processi in corso…")
    for (const [name, child] of activeProcesses.entries()) {
        logLine(name, "chiusura…")
        child.kill("SIGINT")
    }
    setTimeout(() => process.exit(), 500)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

for (const command of commands) {
    if (!command.enabled && command.skipMessage) {
        logLine(command.name, command.skipMessage, "stderr")
    }
}

const sortedCommands = commands
    .filter((cmd) => cmd.enabled)
    .sort((a, b) => commandOrder.indexOf(a.name) - commandOrder.indexOf(b.name))

const startSequentially = async() => {
    for (const command of sortedCommands) {
        const child = spawnCommand(command)
        await waitForReady(command, child)
    }
}

startSequentially().catch((error) => {
    logLine("dev-runner", `sequencer error: ${error.message}`, "stderr")
})
