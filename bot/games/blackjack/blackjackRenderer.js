/**
 * blackjackRenderer.js
 *
 * Responsabilità: Rendering del tavolo Blackjack (captureTableRender)
 * Usato da: BlackjackGame
 *
 * Nota: legge game state, non modifica struttura game
 */

const { AttachmentBuilder } = require("discord.js")
const logger = require("../../utils/logger")
const {
    renderCardTable,
    createBlackjackTableState
} = require("../../rendering/blackjackTableRenderer")

class BlackjackRenderer {
    constructor(gameInstance) {
        this.game = gameInstance
    }

    /**
     * buildPlayerRenderPayload(player): prepara i dati di un player per il rendering
     */
    buildPlayerRenderPayload(player, distributedXp = 0) {
        if (!player || !Array.isArray(player.hands)) return null

        const baseHands = player.hands
            .filter((hand) => Array.isArray(hand?.cards) && hand.cards.length > 0)
            .map((hand) => ({
                ...hand,
                cards: [...hand.cards]
            }))

        const totalHandsForXp = baseHands.length || 1
        const totalXpEarned = Number.isFinite(player.status?.won?.expEarned) ? player.status.won.expEarned : 0
        const computedXp = totalXpEarned > 0 ? Math.round(totalXpEarned / totalHandsForXp) : distributedXp

        const validHands = baseHands.map((hand, index) => ({
            ...hand,
            xp: Number.isFinite(hand.xp) ? hand.xp : (computedXp > 0 ? computedXp : null),
            isActing: player.status?.current === true && player.status?.currentHand === index
        }))

        if (validHands.length === 0) return null

        return {
            id: player.id,
            tag: player.tag,
            username: player.username,
            displayName: player.displayName,
            name: player.name,
            user: player.user,
            hands: validHands
        }
    }

    /**
     * buildDealerState(dealer, options): prepara lo stato del dealer per il rendering
     */
    buildDealerState(dealer, options = {}) {
        const { hideDealerHoleCard = false, maskDealerValue } = options

        const dealerCardsCopy = Array.isArray(dealer.cards) ? [...dealer.cards] : []
        const concealDealerInfo = typeof maskDealerValue === "boolean" ? maskDealerValue : hideDealerHoleCard

        return {
            ...dealer,
            cards: dealerCardsCopy,
            value: dealer.value ?? dealer.total ?? dealer.score ?? 0,
            blackjack: concealDealerInfo ? false : Boolean(dealer.blackjack || dealer.hasBlackjack || dealer.BJ),
            busted: concealDealerInfo ? false : Boolean(dealer.busted || dealer.isBusted)
        }
    }

    /**
     * captureTableRender(options): renderizza lo stato del tavolo come PNG
     *
     * Options: { dealer, players, result, filename, description, hideDealerHoleCard, maskDealerValue, forceResult }
     * Returns: { attachment, filename } | null
     */
    async captureTableRender(options = {}) {
        const {
            dealer = this.game.dealer,
            players = this.game.inGamePlayers,
            result = null,
            filename,
            description,
            hideDealerHoleCard = false,
            maskDealerValue,
            forceResult
        } = options

        if (!dealer || !Array.isArray(dealer.cards) || dealer.cards.length < 1) {
            return null
        }

        const preparedPlayers = []
        for (const player of players ?? []) {
            const payload = this.buildPlayerRenderPayload(player)
            if (payload) {
                preparedPlayers.push(payload)
            }
        }

        if (preparedPlayers.length === 0) {
            return null
        }

        const dealerState = this.buildDealerState(dealer, { hideDealerHoleCard, maskDealerValue })

        try {
            const state = createBlackjackTableState({
                dealer: dealerState,
                players: preparedPlayers,
                round: this.game.hands,
                id: this.game.id
            }, {
                result,
                round: this.game.hands,
                maskDealerHoleCard: hideDealerHoleCard
            })

            state.metadata = {
                ...(state.metadata ?? {}),
                maskDealerHoleCard: hideDealerHoleCard
            }

            if (forceResult !== undefined) {
                state.result = forceResult
            }

            const buffer = await renderCardTable({ ...state, outputFormat: "png" })
            const resolvedFilename = filename ?? `blackjack_table_${this.game.hands}_${Date.now()}.png`

            return {
                attachment: new AttachmentBuilder(buffer, {
                    name: resolvedFilename,
                    description: description ?? `Blackjack table snapshot for round ${this.game.hands}`
                }),
                filename: resolvedFilename
            }
        } catch (error) {
            logger.error("Failed to render blackjack table snapshot", {
                scope: "blackjackRenderer",
                round: this.game.hands,
                tableId: this.game.id,
                error: error.message,
                stack: error.stack
            })
            return null
        }
    }
}

module.exports = BlackjackRenderer
