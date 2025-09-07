const logger = require("./logger");

/**
 * Card Format Converter
 *
 * Converts between game format (2S, KH, TD) and image format (2_of_spades, king_of_hearts)
 * Used to bridge blackjackGame.js and the card table renderer
 */

// Mapping tables
const RANK_MAP = {
    // Game format → Full name
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '7': '7',
    '8': '8',
    '9': '9',
    'T': '10',
    'J': 'jack',
    'Q': 'queen',
    'K': 'king',
    'A': 'ace'
};

const SUIT_MAP = {
    // Game format → Full name
    'S': 'spades',
    'C': 'clubs',
    'H': 'hearts',
    'D': 'diamonds'
};

// Reverse mappings
const RANK_MAP_REVERSE = Object.fromEntries(
    Object.entries(RANK_MAP).map(([k, v]) => [v, k])
);

const SUIT_MAP_REVERSE = Object.fromEntries(
    Object.entries(SUIT_MAP).map(([k, v]) => [v, k])
);

/**
 * Convert game format to image filename
 * @param {string} gameCard - Card in game format (e.g., "2S", "KH", "TD")
 * @returns {string} Image filename without extension (e.g., "2_of_spades", "king_of_hearts")
 *
 * @example
 * gameToImage("2S") // => "2_of_spades"
 * gameToImage("KH") // => "king_of_hearts"
 * gameToImage("TD") // => "10_of_diamonds"
 */
function gameToImage(gameCard) {
    if (!gameCard || typeof gameCard !== 'string' || gameCard.length !== 2) {
        throw new Error(`Invalid game card format: ${gameCard}`);
    }

    const rank = gameCard[0].toUpperCase();
    const suit = gameCard[1].toUpperCase();

    if (!RANK_MAP[rank]) {
        throw new Error(`Unknown rank: ${rank} in card ${gameCard}`);
    }

    if (!SUIT_MAP[suit]) {
        throw new Error(`Unknown suit: ${suit} in card ${gameCard}`);
    }

    return `${RANK_MAP[rank]}_of_${SUIT_MAP[suit]}`;
}

/**
 * Convert image filename to game format
 * @param {string} imageCard - Card in image format (e.g., "2_of_spades", "king_of_hearts")
 * @returns {string} Card in game format (e.g., "2S", "KH")
 *
 * @example
 * imageToGame("2_of_spades") // => "2S"
 * imageToGame("king_of_hearts") // => "KH"
 * imageToGame("10_of_diamonds") // => "TD"
 */
function imageToGame(imageCard) {
    if (!imageCard || typeof imageCard !== 'string') {
        throw new Error(`Invalid image card format: ${imageCard}`);
    }

    const parts = imageCard.split('_of_');
    if (parts.length !== 2) {
        throw new Error(`Invalid image card format (expected rank_of_suit): ${imageCard}`);
    }

    const [rankStr, suitStr] = parts;

    const rank = RANK_MAP_REVERSE[rankStr];
    const suit = SUIT_MAP_REVERSE[suitStr];

    if (!rank) {
        throw new Error(`Unknown rank: ${rankStr} in card ${imageCard}`);
    }

    if (!suit) {
        throw new Error(`Unknown suit: ${suitStr} in card ${imageCard}`);
    }

    return `${rank}${suit}`;
}

/**
 * Convert array of game cards to image format
 * @param {string[]} gameCards - Array of cards in game format
 * @returns {string[]} Array of cards in image format
 */
function gamesToImages(gameCards) {
    if (!Array.isArray(gameCards)) {
        return [];
    }

    return gameCards.map(card => {
        try {
            return gameToImage(card);
        } catch (error) {
            logger.error("Failed to convert card", {
                scope: "cardConverter",
                card,
                error: error.message
            });
            return null;
        }
    }).filter(Boolean);
}

/**
 * Convert array of image cards to game format
 * @param {string[]} imageCards - Array of cards in image format
 * @returns {string[]} Array of cards in game format
 */
function imagesToGames(imageCards) {
    if (!Array.isArray(imageCards)) {
        return [];
    }

    return imageCards.map(card => {
        try {
            return imageToGame(card);
        } catch (error) {
            logger.error("Failed to convert card", {
                scope: "cardConverter",
                card,
                error: error.message
            });
            return null;
        }
    }).filter(Boolean);
}

/**
 * Validate if a string is a valid game card
 * @param {string} card - Card to validate
 * @returns {boolean}
 */
function isValidGameCard(card) {
    if (!card || typeof card !== 'string' || card.length !== 2) {
        return false;
    }

    const rank = card[0].toUpperCase();
    const suit = card[1].toUpperCase();

    return RANK_MAP[rank] !== undefined && SUIT_MAP[suit] !== undefined;
}

/**
 * Validate if a string is a valid image card
 * @param {string} card - Card to validate
 * @returns {boolean}
 */
function isValidImageCard(card) {
    if (!card || typeof card !== 'string') {
        return false;
    }

    const parts = card.split('_of_');
    if (parts.length !== 2) {
        return false;
    }

    const [rank, suit] = parts;
    return RANK_MAP_REVERSE[rank] !== undefined && SUIT_MAP_REVERSE[suit] !== undefined;
}

module.exports = {
    gameToImage,
    imageToGame,
    gamesToImages,
    imagesToGames,
    isValidGameCard,
    isValidImageCard,
    RANK_MAP,
    SUIT_MAP
};
