/**
 * =====================================================
 * Chipsy Dev Runner (Docker Edition)
 *  - Avvia MySQL tramite Docker
 *  - Attende healthcheck del DB
 *  - Lancia bot e pannello in parallelo
 *  - Gestisce log e terminazioni pulite
 * =====================================================
 */

import { spawn, execSync } from "child_process";
import { createRequire } from "module";
import dotenv from "dotenv";
import readline from "readline";
import fs from "fs";

// Per importare moduli CommonJS da ES module
const require = createRequire(import.meta.url);
const { constants } = require("../config");
const sharedLogger = require("../bot/utils/logger");

// Carica le variabili d'ambiente dal file .env
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

// Piccolo filtro per evitare spam di log duplicati in rapida successione
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
  // Metodo A: verifica se esiste /.dockerenv (file presente in tutti i container Docker)
  try {
    fs.accessSync("/.dockerenv");
    return true;
  } catch (_) {}

  // Metodo B: verifica se esiste /proc/1/cgroup e contiene 'docker'
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) return true;
  } catch (_) {}

  // Metodo C: controlla variabile manuale opzionale
  return process.env.DOCKER_ENV === "true";
}

// ============================================================================
// HOST DETECTION: Rileva automaticamente l'ambiente ed imposta MYSQL_HOST
// Questo avviene PRIMA che bot/config.js legga le variabili
// ============================================================================
if (isRunningInDocker()) {
  process.env.MYSQL_HOST = "mysql";
  logSys("Detected Docker/VPS environment → MYSQL_HOST=mysql", { phase: "env" });
} else {
  process.env.MYSQL_HOST = "localhost";
  logSys("Detected local environment → MYSQL_HOST=localhost", { phase: "env" });
}

// --- Funzioni di utilità ----------------------------------------------------

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

// --- Gestione child process -------------------------------------------------

const children = new Map(); // { name: { process, restartCount, shouldRestart } }
let isShuttingDown = false;

/**
 * Spawna un processo figlio con monitoraggio crash e restart automatico
 * @param {string} cmd - Comando da eseguire
 * @param {string[]} args - Argomenti
 * @param {string} name - Nome del processo per logging
 * @param {boolean} autoRestart - Se true, riavvia automaticamente in caso di crash
 * @param {number} inheritRestartCount - Restart count ereditato (per preservare il contatore)
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
      // Shutdown normale - rimuovi dalla mappa
      children.delete(name);
      logSys(`${name} terminato correttamente`);
      return;
    }

    if (code !== 0 && code !== null) {
      logErr(`${name} crashato con codice ${code}`);
    } else if (signal) {
      logWarn(`${name} terminato da segnale ${signal}`);
    }

    // Auto-restart se abilitato e non in shutdown
    if (childInfo?.shouldRestart && !isShuttingDown) {
      childInfo.restartCount += 1;

      if (childInfo.restartCount > constants.retry.childProcess.maxRestarts) {
        logErr(`${name} crashato troppe volte (${childInfo.restartCount}). Restart disabilitato.`);
        childInfo.shouldRestart = false;
        return;
      }

      const delay = Math.min(1000 * childInfo.restartCount, constants.retry.childProcess.maxDelay);
      logWarn(`Riavvio ${name} tra ${delay}ms... (tentativo ${childInfo.restartCount}/${constants.retry.childProcess.maxRestarts})`);

      setTimeout(() => {
        if (!isShuttingDown) {
          logSys(`Riavvio ${name}...`);
          // Passa il restartCount corrente per preservare il contatore
          spawnProc(childInfo.cmd, childInfo.args, childInfo.name, true, childInfo.restartCount);
        }
      }, delay);
    } else {
      children.delete(name);
    }
  });

  child.on("error", (error) => {
    logErr(`Errore spawn ${name}: ${error.message}`);
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

// --- Gestione chiusura graceful ---------------------------------------------

/**
 * Gestisce la terminazione graceful di tutti i processi figli
 * - Invia SIGINT ai figli
 * - Attende fino a 10 secondi per chiusura normale
 * - Forza SIGKILL se necessario
 */
async function handleExit() {
  if (isShuttingDown) {
    logWarn("Shutdown già in corso...");
    return;
  }

  isShuttingDown = true;
  logWarn("🛑 Terminazione in corso...");

  // Chiudi readline per evitare nuovi input
  rl.close();

  if (children.size === 0) {
    logSys("Nessun processo figlio da terminare");
    process.exit(0);
  }

  // Fase 1: Invia SIGINT per graceful shutdown
  logSys(`Invio SIGINT a ${children.size} processi...`);
  for (const [name, childInfo] of children) {
    try {
      if (childInfo.process && !childInfo.process.killed) {
        childInfo.process.kill("SIGINT");
      }
    } catch (error) {
      logWarn(`Impossibile inviare SIGINT a ${name}: ${error.message}`);
    }
  }

  // Fase 2: Attendi graceful shutdown
  const startTime = Date.now();

  while (children.size > 0 && (Date.now() - startTime) < constants.timeouts.devRunnerShutdown) {
    await sleep(100);
  }

  // Fase 3: Force kill eventuali processi rimasti
  if (children.size > 0) {
    logWarn(`${children.size} processi ancora attivi. Invio SIGKILL...`);
    for (const [name, childInfo] of children) {
      try {
        if (childInfo.process && !childInfo.process.killed) {
          childInfo.process.kill("SIGKILL");
          logWarn(`SIGKILL inviato a ${name}`);
        }
      } catch (error) {
        logWarn(`Impossibile killare ${name}: ${error.message}`);
      }
    }
    // Breve attesa finale
    await sleep(500);
  }

  logOk("Tutti i processi terminati correttamente ✅");
  process.exit(0);
}

// Gestione segnali di terminazione
process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

// Gestione errori non catturati (evita crash silenti)
process.on("uncaughtException", (error) => {
  logErr(`Eccezione non gestita: ${error.message}`, {
    stack: error.stack
  });
  handleExit();
});

process.on("unhandledRejection", (reason, promise) => {
  const baseMessage = reason instanceof Error ? reason.message : String(reason);
  logErr(`Promise rejection non gestita: ${baseMessage}`, {
    stack: reason instanceof Error ? reason.stack : undefined
  });
  handleExit();
});

// --- Avvio sequenziale ------------------------------------------------------

async function main() {
  console.clear();
  logSys("🚀 Avvio completo ambiente Chipsy...");

  // 1️⃣ Avvio MySQL tramite Docker
  try {
    logSys("Avvio Docker MySQL...");
    await runCommandOnce("docker", ["compose", "up", "-d", "mysql"], "docker:compose");
  } catch (e) {
    logErr("Impossibile avviare Docker Compose. Assicurati che Docker Desktop sia attivo.");
    process.exit(1);
  }

  // 2️⃣ Attesa healthcheck MySQL
  logSys("⏳ Attendo che MySQL diventi 'healthy'...");
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
    logErr(`MySQL non è pronto entro il tempo limite (${constants.timeouts.mysqlHealthcheck / 1000}s).`);
    process.exit(1);
  }
  logOk("MySQL pronto e funzionante ✅");

  // 3️⃣ Avvio bot e pannello in parallelo
  logSys("Avvio bot e pannello web...");
  spawnProc("npm", ["run dev:bot"], "bot");
  await sleep(constants.development.panelStartDelay); // Piccolo offset per separare output nei log
  spawnProc("npm", ["run dev:panel"], "panel");

  // 4️⃣ Informazioni riepilogative
  logOk("Tutti i servizi sono in esecuzione.");
  logSys("Endpoints disponibili:", { stage: "summary" });
  logSys("• Pannello Web: http://localhost:8080", { stage: "summary", target: "web" });
  logSys("• Bot API: http://localhost:8082/api", { stage: "summary", target: "api" });
  logSys("• MySQL CLI: docker exec -it chipsy-mysql mysql -u root -p", { stage: "summary", target: "mysql" });

  // 5️⃣ Mantieni il processo aperto per poterlo terminare con Ctrl+C
  rl.on("SIGINT", handleExit);
}

main().catch((err) => {
  logErr(`Errore fatale: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
