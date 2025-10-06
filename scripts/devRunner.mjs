/**
 * =====================================================
 * Chipsy Dev Runner (Docker Edition)
 *  - Spins up MySQL with Docker because apparently that's our life
 *  - Waits for the DB health check before anything melts
 *  - Boots bot and panel in parallel
 *  - Pipes logs and kills processes without mercy
 * =====================================================
 */

import { spawn, execSync } from "child_process";
import { createRequire } from "module";
import dotenv from "dotenv";
import readline from "readline";
import fs from "fs";
import path from "path";

// Drag CommonJS modules into this ESM sandbox.
const require = createRequire(import.meta.url);
const { constants } = require("../config");
const sharedLogger = require("../bot/utils/logger");

// Load .env because the process sure won't.
dotenv.config();

const LOG_SCOPE = "devRunner";

const logMessage = (level, message, meta = {}) => {
  const fn = sharedLogger[level] || sharedLogger.info;
  const payload = { ...meta };
  if (!payload.scope) {
    payload.scope = LOG_SCOPE;
  }
  fn(message, payload);
};

const logSys = (message, meta) => logMessage("info", message, meta);
const logOk = (message, meta) => logMessage("info", message, meta);
const logWarn = (message, meta) => logMessage("warn", message, meta);
const logErr = (message, meta) => logMessage("error", message, meta);

// Cheap dedupe layer so the console stops repeating itself every millisecond.
const DEDUPE_WINDOW_MS = 1500;
const DEDUPE_CACHE_LIMIT = 256;
const recentLogCache = new Map();

const normalizeDedupeMessage = (value) => {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/(\.\.\.|…)/g, " ")
    .replace(/[^\w\s:/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const shouldSkipDuplicateLog = (level, message) => {
  const normalized = normalizeDedupeMessage(message);
  if (!normalized) return false;
  const key = `${level}:${normalized}`;
  const now = Date.now();
  const lastLoggedAt = recentLogCache.get(key);
  if (lastLoggedAt && now - lastLoggedAt < DEDUPE_WINDOW_MS) {
    return true;
  }
  recentLogCache.set(key, now);
  if (recentLogCache.size > DEDUPE_CACHE_LIMIT) {
    for (const [entryKey, timestamp] of recentLogCache) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        recentLogCache.delete(entryKey);
      }
    }
  }
  return false;
};

function isRunningInDocker() {
  // Plan A: /.dockerenv exists on every Docker container, allegedly.
  try {
    fs.accessSync("/.dockerenv");
    return true;
  } catch (error) {
    logMessage("debug", "Docker marker /.dockerenv not detected", {
      phase: "env",
      error: error?.message
    });
  }

  // Plan B: sniff /proc/1/cgroup for docker/containerd breadcrumbs.
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) return true;
  } catch (error) {
    logMessage("debug", "Docker marker /proc/1/cgroup not detected", {
      phase: "env",
      error: error?.message
    });
  }

  // Plan C: trust whoever flipped DOCKER_ENV.
  return process.env.DOCKER_ENV === "true";
}

// ============================================================================
// HOST DETECTION: decide MYSQL_HOST before bot/config.js wakes up
// ============================================================================
if (isRunningInDocker()) {
  process.env.MYSQL_HOST = "mysql";
  logSys("Detected Docker/VPS environment → MYSQL_HOST=mysql", { phase: "env" });
} else {
  process.env.MYSQL_HOST = "localhost";
  logSys("Detected local environment → MYSQL_HOST=localhost", { phase: "env" });
}

// --- Utility noise ----------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const normalizeLine = (input) => {
  if (input === undefined || input === null) return "";
  if (Buffer.isBuffer(input)) return input.toString("utf8").replace(/\s+$/, "");
  return String(input).replace(/\s+$/, "");
};

const isStructuredLogLine = (text) => {
  if (!text || typeof text !== "string") return false;
  return /^\[\d{2}:\d{2}:\d{2}\]\s/.test(text) && text.includes("scope=");
};

const parseStructuredLine = (text) => {
  const parts = text.split("│").map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const header = parts.shift();

  const headerMatch = header.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+([A-Z]+)\s+(.*)$/);
  if (!headerMatch) return null;
  const level = headerMatch[2].toLowerCase();
  let messageSection = headerMatch[3].trim();
  let extractedScope = null;
  if (messageSection.includes("|")) {
    const [maybeScope, ...rest] = messageSection.split("|");
    if (maybeScope.trim()) {
      extractedScope = maybeScope.trim();
      messageSection = rest.join("|").trim();
    }
  }
  const meta = {};
  if (parts.length) {
    const metaTokens = parts.join(" ").split(/\s+/).filter(Boolean);
    metaTokens.forEach((token) => {
      const [key, ...valueParts] = token.split("=");
      if (!key || !valueParts.length) return;
      const value = valueParts.join("=");
      meta[key] = value;
    });
  }

  if (extractedScope && !meta.scope) {
    meta.scope = extractedScope;
  }

  return { level, message: messageSection, meta };
};

const logProcessLine = (level, processName, line, stream) => {
  const text = normalizeLine(line);
  if (!text) return;
  if (isStructuredLogLine(text)) {
    const parsed = parseStructuredLine(text);
    if (parsed) {
      if (shouldSkipDuplicateLog(parsed.level, parsed.message)) {
        return;
      }
      const combinedMeta = {
        ...parsed.meta,
        scope: parsed.meta.scope || processName,
        process: parsed.meta.process || processName,
        stream
      };
      logMessage(parsed.level, parsed.message, combinedMeta);
    } else {
      process.stdout.write(`${text}\n`);
    }
    return;
  }
  if (shouldSkipDuplicateLog(level, text)) {
    return;
  }
  logMessage(level, text, {
    scope: "process",
    process: processName,
    stream
  });
};

const attachStreamLogger = (stream, name, streamName) => {
  if (!stream) return;
  const rlStream = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
    terminal: false
  });
  const level = streamName === "stderr" ? "warn" : "info";
  rlStream.on("line", (line) => logProcessLine(level, name, line, streamName));
  stream.on("error", (error) => {
    logWarn(`Stream error from ${name} (${streamName}): ${error.message}`, {
      process: name,
      stream: streamName
    });
  });
};

const attachProcessLogging = (child, name) => {
  attachStreamLogger(child.stdout, name, "stdout");
  attachStreamLogger(child.stderr, name, "stderr");
};

// --- Child-process babysitting ----------------------------------------------

const children = new Map(); // { name: { process, restartCount, shouldRestart } }
let isShuttingDown = false;

/**
 * Spawn a child process, watch it explode, optionally auto-restart it.
 * @param {string} cmd - Command to run
 * @param {string[]} args - Args for the command
 * @param {string} name - Label for logs
 * @param {boolean} autoRestart - Restart if it dies
 * @param {number} inheritRestartCount - Keeps the restart counter honest
 */
function spawnProc(cmd, args, name, autoRestart = true, inheritRestartCount = 0) {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: true });

  children.set(name, {
    process: child,
    restartCount: inheritRestartCount,
    shouldRestart: autoRestart,
    name,
    cmd,
    args
  });

  attachProcessLogging(child, name);

  child.on("exit", (code, signal) => {
    const childInfo = children.get(name);

    if (isShuttingDown) {
      children.delete(name);
      logSys(`${name} exited cleanly`);
      return;
    }

    if (code !== 0 && code !== null) {
      logErr(`${name} crashed with exit code ${code}`);
    } else if (signal) {
      logWarn(`${name} died via signal ${signal}`);
    }

    if (childInfo?.shouldRestart && !isShuttingDown) {
      childInfo.restartCount += 1;

      if (childInfo.restartCount > constants.retry.childProcess.maxRestarts) {
        logErr(`${name} crashed ${childInfo.restartCount} times. Auto-restart disabled.`);
        childInfo.shouldRestart = false;
        return;
      }

      const delay = Math.min(1000 * childInfo.restartCount, constants.retry.childProcess.maxDelay);
      logWarn(`Restarting ${name} in ${delay}ms (attempt ${childInfo.restartCount}/${constants.retry.childProcess.maxRestarts})`);

      setTimeout(() => {
        if (!isShuttingDown) {
          logSys(`Restarting ${name} now...`);
          spawnProc(childInfo.cmd, childInfo.args, childInfo.name, true, childInfo.restartCount);
        }
      }, delay);
    } else {
      children.delete(name);
    }
  });

  child.on("error", (error) => {
    logErr(`Failed to spawn ${name}: ${error.message}`);
  });

  return child;
}

const runCommandOnce = (cmd, args, name, options = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: options.shell ?? false,
      env: { ...process.env, ...(options.env || {}) },
      cwd: options.cwd || process.cwd()
    });

    attachProcessLogging(child, name);

    child.on("exit", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`${name} exited with code ${code ?? "null"}`));
      }
    });

    child.on("error", (error) => {
      reject(error);
    });
  });
};

// --- Graceful-ish shutdown ---------------------------------------------------

/**
 * Try to shut down every child without torching the box:
 * - Send SIGINT first
 * - Wait a bit like civilized people
 * - Swing SIGKILL if they ignore us
 */
async function handleExit() {
  if (isShuttingDown) {
    logWarn("Shutdown already in progress...");
    return;
  }

  isShuttingDown = true;
  logWarn("🛑 Tearing everything down...");

  // Kill readline so no more input sneaks in.
  rl.close();

  if (children.size === 0) {
    logSys("No child processes left to terminate");
    process.exit(0);
  }

  // Phase 1: ask nicely with SIGINT.
  logSys(`Sending SIGINT to ${children.size} processes...`);
  for (const [name, childInfo] of children) {
    try {
      if (childInfo.process && !childInfo.process.killed) {
        childInfo.process.kill("SIGINT");
      }
    } catch (error) {
      logWarn(`Failed to deliver SIGINT to ${name}: ${error.message}`);
    }
  }

  // Phase 2: wait a little.
  const startTime = Date.now();

  while (children.size > 0 && (Date.now() - startTime) < constants.timeouts.devRunnerShutdown) {
    await sleep(100);
  }

  // Phase 3: swing SIGKILL at whatever still breathes.
  if (children.size > 0) {
    logWarn(`${children.size} processes still alive. Sending SIGKILL...`);
    for (const [name, childInfo] of children) {
      try {
        if (childInfo.process && !childInfo.process.killed) {
          childInfo.process.kill("SIGKILL");
          logWarn(`SIGKILL sent to ${name}`);
        }
      } catch (error) {
        logWarn(`Unable to kill ${name}: ${error.message}`);
      }
    }
    // Tiny pause while the OS cleans up.
    await sleep(500);
  }

  logOk("Every child process is finally dead ✅");
  process.exit(0);
}

// Signal wiring
process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

// Crash handlers so we at least know what exploded.
process.on("uncaughtException", (error) => {
  logErr(`Unhandled exception: ${error.message}`, {
    stack: error.stack
  });
  handleExit();
});

process.on("unhandledRejection", (reason, promise) => {
  const baseMessage = reason instanceof Error ? reason.message : String(reason);
  logErr(`Unhandled promise rejection: ${baseMessage}`, {
    stack: reason instanceof Error ? reason.stack : undefined
  });
  handleExit();
});

// --- Startup sequence -------------------------------------------------------

async function main() {
  console.clear();
  logSys("🚀 Booting the full Chipsy stack...");

  // 1️⃣ Spin up MySQL via Docker
  const composeArgs = ["compose"];
  const composeFiles = ["docker-compose.yml"];
  const localOverridePath = path.join(process.cwd(), "docker-compose.local.yml");
  if (fs.existsSync(localOverridePath)) {
    composeFiles.push("docker-compose.local.yml");
  }
  composeFiles.forEach((file) => {
    composeArgs.push("-f", file);
  });
  composeArgs.push("up", "-d", "mysql");

  try {
    logSys("Starting Docker MySQL service...");
    await runCommandOnce("docker", composeArgs, "docker:compose");
  } catch (e) {
    logErr("Unable to start Docker Compose. Make sure Docker Desktop is awake.");
    process.exit(1);
  }

  // 2️⃣ Wait for MySQL to report healthy
  logSys("⏳ Waiting for MySQL to become healthy...");
  let healthy = false;
  const maxHealthcheckAttempts = Math.floor(constants.timeouts.mysqlHealthcheck / constants.development.healthcheckInterval);

  for (let i = 0; i < maxHealthcheckAttempts; i++) {
    try {
      const status = execSync("docker inspect -f '{{.State.Health.Status}}' chipsy-mysql")
        .toString()
        .trim();
      if (status === "healthy") {
        healthy = true;
        break;
      }
    } catch {}
    await sleep(constants.development.healthcheckInterval);
  }

  if (!healthy) {
    logErr(`MySQL never got healthy within ${constants.timeouts.mysqlHealthcheck / 1000}s.`);
    process.exit(1);
  }
  logOk("MySQL is up ✅");

  // 3️⃣ Launch bot and panel in parallel
  logSys("Starting bot and web panel...");
  spawnProc("npm", ["run dev:bot"], "bot");
  await sleep(constants.development.panelStartDelay); // Small offset so the logs are readable.
  spawnProc("npm", ["run dev:panel"], "panel");

  // 4️⃣ Summary spam
  logOk("All services are running.");
  logSys("Available endpoints:", { stage: "summary" });
  logSys("• Web panel: http://localhost:8080", { stage: "summary", target: "web" });
  logSys("• Bot API: http://localhost:8082/api", { stage: "summary", target: "api" });
  logSys("• MySQL CLI: docker exec -it chipsy-mysql mysql -u root -p", { stage: "summary", target: "mysql" });

  // 5️⃣ Keep the runner alive so Ctrl+C still works
  rl.on("SIGINT", handleExit);
}

main().catch((err) => {
  logErr(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
