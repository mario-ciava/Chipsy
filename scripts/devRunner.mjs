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
import chalk from "chalk";
import fs from "fs";

// Per importare moduli CommonJS da ES module
const require = createRequire(import.meta.url);
const constants = require("../config/constants.js");

// Carica le variabili d'ambiente dal file .env
dotenv.config();

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
  console.log("[env] Detected Docker/VPS environment → MYSQL_HOST=mysql");
} else {
  process.env.MYSQL_HOST = "localhost";
  console.log("[env] Detected local environment → MYSQL_HOST=localhost");
}

// --- Funzioni di utilità ----------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function logSys(msg) {
  console.log(chalk.cyan(`[system] ${msg}`));
}
function logOk(msg) {
  console.log(chalk.green(`[ok] ${msg}`));
}
function logWarn(msg) {
  console.log(chalk.yellow(`[warn] ${msg}`));
}
function logErr(msg) {
  console.log(chalk.red(`[error] ${msg}`));
}

// --- Gestione child process -------------------------------------------------

const children = new Map(); // { name: { process, restartCount, shouldRestart } }
let isShuttingDown = false;

/**
 * Spawna un processo figlio con monitoraggio crash e restart automatico
 * @param {string} cmd - Comando da eseguire
 * @param {string[]} args - Argomenti
 * @param {string} name - Nome del processo per logging
 * @param {string} color - Colore chalk per output
 * @param {boolean} autoRestart - Se true, riavvia automaticamente in caso di crash
 * @param {number} inheritRestartCount - Restart count ereditato (per preservare il contatore)
 */
function spawnProc(cmd, args, name, color, autoRestart = true, inheritRestartCount = 0) {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: true });

  children.set(name, {
    process: child,
    restartCount: inheritRestartCount,
    shouldRestart: autoRestart,
    name,
    cmd,
    args,
    color
  });

  const prefix = chalk[color](`[${name}]`);
  const log = (data) => process.stdout.write(`${prefix} ${data}`);

  child.stdout.on("data", log);
  child.stderr.on("data", log);

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
          spawnProc(childInfo.cmd, childInfo.args, childInfo.name, childInfo.color, true, childInfo.restartCount);
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
  logErr(`Eccezione non gestita: ${error.message}`);
  console.error(error.stack);
  handleExit();
});

process.on("unhandledRejection", (reason, promise) => {
  logErr(`Promise rejection non gestita: ${reason}`);
  console.error(promise);
  handleExit();
});

// --- Avvio sequenziale ------------------------------------------------------

async function main() {
  console.clear();
  logSys("🚀 Avvio completo ambiente Chipsy...");

  // 1️⃣ Avvio MySQL tramite Docker
  try {
    logSys("Avvio Docker MySQL...");
    execSync("docker compose up -d mysql", { stdio: "inherit" });
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
  spawnProc("npm", ["run dev:bot"], "bot", "magenta");
  await sleep(constants.development.panelStartDelay); // Piccolo offset per separare output nei log
  spawnProc("npm", ["run dev:panel"], "panel", "blue");

  // 4️⃣ Informazioni riepilogative
  logOk("Tutti i servizi sono in esecuzione.");
  console.log("");
  console.log(chalk.bold(`➡️  Pannello Web: ${chalk.green("http://localhost:8080")}`));
  console.log(chalk.bold(`➡️  Bot API: ${chalk.green("http://localhost:8082/api")}`));
  console.log(chalk.bold(`➡️  MySQL: ${chalk.green("docker exec -it chipsy-mysql mysql -u root -p")}`));
  console.log("");

  // 5️⃣ Mantieni il processo aperto per poterlo terminare con Ctrl+C
  rl.on("SIGINT", handleExit);
}

main().catch((err) => {
  logErr(`Errore fatale: ${err.message}`);
  process.exit(1);
});
