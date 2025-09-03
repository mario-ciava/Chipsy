/**
 * ============================================================================
 * ASYNC UTILITIES - Funzioni asincrone di utilità
 * ============================================================================
 *
 * Centralizza funzioni async comuni per evitare duplicazioni nel codebase.
 *
 * STORIA: Queste funzioni erano duplicate in 5+ file diversi con nomi diversi
 * (delay, sleep, wait). Ora centralizzate qui.
 */

/**
 * Crea una Promise che si risolve dopo un determinato tempo.
 *
 * @param {number} ms - Millisecondi da attendere
 * @returns {Promise<void>}
 *
 * @example
 * await sleep(1000) // Attendi 1 secondo
 * await sleep(500)  // Attendi 500ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Alias di sleep() per retrocompatibilità con codice esistente.
 * @deprecated Usa sleep() invece
 */
const wait = sleep

/**
 * Alias di sleep() per retrocompatibilità con codice esistente.
 * @deprecated Usa sleep() invece
 */
const delay = sleep

module.exports = {
    sleep,
    wait,    // Alias
    delay    // Alias
}
