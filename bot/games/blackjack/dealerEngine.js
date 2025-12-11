const HandEvaluator = require("./handEvaluator")
const { sleep } = require("../../utils/helpers")
const config = require("../../../config")
const logger = require("../../../shared/logger")

const CARD_VALUE_MAP = {
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    T: "10",
    9: "9",
    8: "8",
    7: "7",
    6: "6",
    5: "5",
    4: "4",
    3: "3",
    2: "2"
}

const CARD_SUIT_MAP = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
}

function formatCardLabel(cardCode) {
    if (!cardCode || typeof cardCode !== "string") return cardCode ?? ""
    const value = CARD_VALUE_MAP[cardCode[0]] ?? cardCode[0]
    const suit = CARD_SUIT_MAP[cardCode[1]] ?? cardCode[1] ?? ""
    return `${value}${suit}`
}

/**
 * DealerEngine
 *
 * Manages dealer-specific logic for blackjack, including hit/stand rules,
 * card drawing, hand evaluation, and payout processing.
 */
class DealerEngine {
    constructor(game) {
        this.game = game
    }

    /**
     * Evaluates the dealer's hand.
     */
    evaluateDealerHand() {
        if (!this.game.dealer) return
        HandEvaluator.evaluateHand(this.game.dealer, { isPlayerHand: false })
    }

    /**
     * Checks if dealer should hit (standard blackjack rules: hit on 16 or less).
     *
     * @returns {boolean}
     */
    shouldDealerHit() {
        return HandEvaluator.shouldDealerHit(this.game.dealer)
    }

    /**
     * Draws a card for the dealer.
     *
     * @returns {Promise<string>} The card code drawn
     */
    async drawCard() {
        if (!Array.isArray(this.game.cards) || this.game.cards.length < 1) {
            throw new Error("Deck is empty")
        }
        const newCard = await this.game.PickRandom(this.game.cards, 1)
        this.game.dealer.cards = this.game.dealer.cards.concat(newCard)
        this.evaluateDealerHand()
        return newCard[0]
    }

    /**
     * Reveals the dealer's hidden card and logs to timeline.
     */
    revealHiddenCard() {
        if (!this.game.dealer || this.game.dealer.cards.length < 2) {
            logger.warn("Cannot reveal dealer card: insufficient cards", {
                scope: "dealerEngine",
                cardCount: this.game.dealer?.cards?.length
            })
            return
        }
        this.game.appendDealerTimeline("**Dealer** reveals hidden card")
    }

    /**
     * Plays the dealer's hand according to standard blackjack rules.
     * Dealer hits on 16 or less, stands on 17+.
     *
     * @param {Function} onCardDrawn - Optional callback after each card is drawn
     * @returns {Promise<Object>} Dealer's final hand state
     */
    async playHand(onCardDrawn) {
        this.evaluateDealerHand()

        // Reveal hidden card first
        this.revealHiddenCard()
        if (typeof onCardDrawn === "function") {
            await onCardDrawn("reveal")
        }
        await sleep(config.delays.short.default)

        // Draw cards until 17 or higher
        while (this.shouldDealerHit()) {
            const drawnCard = await this.drawCard()
            const cardLabel = formatCardLabel(drawnCard)
            const value = HandEvaluator.getHandValue(this.game.dealer)

            this.game.appendDealerTimeline(`**Dealer** draws ${cardLabel} (total ${value}).`)

            if (typeof onCardDrawn === "function") {
                await onCardDrawn(drawnCard)
            }

            await sleep(config.delays.short.default)
        }

        // Log final dealer action
        const isBusted = HandEvaluator.isBust(this.game.dealer)
        const finalValue = HandEvaluator.getHandValue(this.game.dealer)

        if (isBusted) {
            this.game.appendDealerTimeline("**Dealer** busts.")
        } else {
            this.game.appendDealerTimeline(`**Dealer** stands at ${finalValue}.`)
        }

        return this.game.dealer
    }

    /**
     * Gets the dealer's upcard (first card).
     *
     * @returns {string|null} Card code or null
     */
    getUpcard() {
        return this.game.dealer?.cards?.[0] || null
    }

    /**
     * Gets the rank of the dealer's upcard.
     *
     * @returns {string|null} Card rank (A, K, Q, etc.) or null
     */
    getUpcardRank() {
        const upcard = this.getUpcard()
        return upcard ? upcard.split("")[0] : null
    }

    /**
     * Checks if dealer has an Ace showing (upcard).
     *
     * @returns {boolean}
     */
    hasAceShowing() {
        return this.getUpcardRank() === "A"
    }

    /**
     * Checks if dealer has blackjack.
     *
     * @returns {boolean}
     */
    hasBlackjack() {
        return HandEvaluator.isBlackjack(this.game.dealer)
    }

    /**
     * Gets formatted card label for display.
     *
     * @param {string} cardCode
     * @returns {string}
     */
    static formatCard(cardCode) {
        return formatCardLabel(cardCode)
    }
}

module.exports = DealerEngine
