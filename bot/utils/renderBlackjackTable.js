const { createCanvas, loadImage } = require("canvas");
const path = require("path");
const logger = require("./logger");
const { gameToImage, gamesToImages, isValidGameCard } = require("./cardConverter");
let sharp;

// Load Sharp only if installed (optional for high-quality downscaling)
try {
    sharp = require("sharp");
} catch {
    logger.debug("Sharp not installed - using standard canvas rendering", { scope: "renderBlackjack" });
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Scaling
    scale: 0.75,
    scaleFactor: 2, // Retina super-sampling

    // Card dimensions
    cardWidth: 140,
    cardHeight: 200,
    cardSpacing: 50,

    // Typography
    fontSize: 26,
    titleFontSize: 42,
    subtitleFontSize: 32,
    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    fontBold: "bold",

    // Colors - Professional casino palette
    tableFeltDark: "#0A2E1F",      // Dark green felt
    tableFeltLight: "#0F4A2E",     // Light green felt
    tableFeltAccent: "#1A5C3A",    // Accent green
    dividerColor: "#D4AF37",       // Gold divider
    textPrimary: "#FFFFFF",
    textSecondary: "#E0E0E0",
    textShadow: "rgba(0, 0, 0, 0.8)",
    winColor: "#4CAF50",           // Material green
    loseColor: "#F44336",          // Material red
    pushColor: "#FFC107",          // Material amber
    chipColor: "#DC143C",          // Crimson for chips
    borderColor: "#2E7D5A",        // Subtle border

    // Spacing
    sectionPadding: 60,
    dividerHeight: 4,
    borderRadius: 15,

    // Cache settings
    maxCacheSize: 100, // Max images in cache

    // Paths
    cardsPath: path.join(__dirname, "../../assets/cards")
};

// Apply scaling to dimensions
const CARD_WIDTH = CONFIG.cardWidth * CONFIG.scale;
const CARD_HEIGHT = CONFIG.cardHeight * CONFIG.scale;
const CARD_SPACING = CONFIG.cardSpacing * CONFIG.scale;
const FONT_SIZE = CONFIG.fontSize * CONFIG.scale;
const TITLE_FONT_SIZE = CONFIG.titleFontSize * CONFIG.scale;

// ============================================================================
// IMAGE CACHING WITH LRU EVICTION
// ============================================================================

/**
 * Global cache for card images with LRU eviction
 * @type {Map<string, {image: Image, lastUsed: number}>}
 */
const imageCache = new Map();

/**
 * Evict least recently used images if cache exceeds max size
 */
function evictLRU() {
    if (imageCache.size <= CONFIG.maxCacheSize) {
        return;
    }

    // Sort by lastUsed timestamp
    const entries = Array.from(imageCache.entries())
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    // Remove oldest 20% of entries
    const toRemove = Math.ceil(imageCache.size * 0.2);
    for (let i = 0; i < toRemove; i++) {
        imageCache.delete(entries[i][0]);
    }

    logger.debug(`Evicted ${toRemove} images from cache`, {
        scope: "renderBlackjack",
        newSize: imageCache.size
    });
}

/**
 * Preload and cache a card image
 * @param {string} cardName - Card filename without extension (e.g., "ace_of_spades")
 * @returns {Promise<Image>}
 */
async function loadCardImage(cardName) {
    // Check cache
    if (imageCache.has(cardName)) {
        const cached = imageCache.get(cardName);
        cached.lastUsed = Date.now();
        return cached.image;
    }

    const cardPath = path.join(CONFIG.cardsPath, `${cardName}.png`);

    try {
        const image = await loadImage(cardPath);

        // Add to cache with timestamp
        imageCache.set(cardName, {
            image,
            lastUsed: Date.now()
        });

        // Evict old entries if needed
        evictLRU();

        return image;
    } catch (error) {
        logger.error("Failed to load card image", {
            scope: "renderBlackjack",
            cardName,
            cardPath,
            error: error.message
        });
        throw new Error(`Card image not found: ${cardName}`);
    }
}

/**
 * Normalize card name - accepts both game format (2S) and image format (2_of_spades)
 * @param {string} cardName
 * @returns {string} Image format card name
 */
function normalizeCardName(cardName) {
    if (!cardName || typeof cardName !== "string") {
        throw new Error(`Invalid card name: ${cardName}`);
    }

    // Check if it's game format (2 chars like "2S", "KH")
    if (cardName.length === 2 && isValidGameCard(cardName)) {
        return gameToImage(cardName);
    }

    // Assume it's already image format
    return cardName;
}

// ============================================================================
// RENDERING FUNCTIONS
// ============================================================================

/**
 * Calculate canvas dimensions based on content
 * @param {Object} params
 * @returns {{ width: number, height: number }}
 */
function calculateCanvasDimensions(params) {
    const { dealerCards = [], playerHands = [] } = params;

    // Find maximum number of cards in any hand
    let maxCards = dealerCards.length;
    for (const hand of playerHands) {
        if (hand.cards && hand.cards.length > maxCards) {
            maxCards = hand.cards.length;
        }
    }

    // Calculate dimensions with padding
    const width = Math.max(
        800 * CONFIG.scale, // Minimum width
        maxCards * (CARD_WIDTH + CARD_SPACING) + CARD_SPACING * 3
    );

    // Height depends on number of player hands (for splits)
    const handHeight = CARD_HEIGHT + CARD_SPACING * 2;
    const dealerHeight = handHeight;
    const playerHeight = handHeight * Math.max(1, playerHands.length);
    const padding = CARD_SPACING * 4;

    const height = dealerHeight + playerHeight + padding;

    return { width, height };
}

/**
 * Draw professional casino table background with felt texture
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 */
function drawTableBackground(ctx, width, height) {
    // Base felt gradient (vertical)
    const feltGradient = ctx.createLinearGradient(0, 0, 0, height);
    feltGradient.addColorStop(0, CONFIG.tableFeltDark);
    feltGradient.addColorStop(0.5, CONFIG.tableFeltLight);
    feltGradient.addColorStop(1, CONFIG.tableFeltDark);
    ctx.fillStyle = feltGradient;
    ctx.fillRect(0, 0, width, height);

    // Add radial lighting effect (spotlight from center)
    const spotlight = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) / 1.5
    );
    spotlight.addColorStop(0, "rgba(255, 255, 255, 0.08)");
    spotlight.addColorStop(0.6, "rgba(255, 255, 255, 0.02)");
    spotlight.addColorStop(1, "rgba(0, 0, 0, 0.2)");
    ctx.fillStyle = spotlight;
    ctx.fillRect(0, 0, width, height);

    // Subtle noise texture for felt realism
    for (let i = 0; i < width * height / 8000; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const brightness = Math.random() * 0.15;
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
        ctx.fillRect(x, y, 1, 1);
    }
}

/**
 * Draw text with professional shadow and glow
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {string} color
 * @param {boolean} glow - Add glow effect
 */
function drawTextWithShadow(ctx, text, x, y, color = CONFIG.textPrimary, glow = false) {
    // Glow effect for important text
    if (glow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10 * CONFIG.scale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }

    // Deep shadow for depth
    ctx.fillStyle = CONFIG.textShadow;
    ctx.fillText(text, x + 2, y + 3);

    // Main text
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
}

/**
 * Draw golden divider line between sections
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} y - Y position
 * @param {number} width - Canvas width
 */
function drawDivider(ctx, y, width) {
    const dividerY = y - CARD_SPACING;
    const padding = CARD_SPACING * 2;

    // Glow effect
    ctx.shadowColor = CONFIG.dividerColor;
    ctx.shadowBlur = 15 * CONFIG.scale;
    ctx.shadowOffsetY = 0;

    // Gradient divider
    const gradient = ctx.createLinearGradient(padding, dividerY, width - padding, dividerY);
    gradient.addColorStop(0, "rgba(212, 175, 55, 0)");
    gradient.addColorStop(0.1, CONFIG.dividerColor);
    gradient.addColorStop(0.5, CONFIG.dividerColor);
    gradient.addColorStop(0.9, CONFIG.dividerColor);
    gradient.addColorStop(1, "rgba(212, 175, 55, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(padding, dividerY, width - padding * 2, CONFIG.dividerHeight * CONFIG.scale);

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
}

/**
 * Draw result banner (WIN/LOSE/PUSH)
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} result - "win", "lose", "push", or null
 * @param {number} x
 * @param {number} y
 * @param {number} width
 */
function drawResultBanner(ctx, result, x, y, width) {
    if (!result) return;

    const bannerHeight = 60 * CONFIG.scale;
    const bannerY = y;

    // Determine colors and text
    let bgColor, textColor, text;
    switch (result) {
        case "win":
            bgColor = CONFIG.winColor;
            textColor = "#FFFFFF";
            text = "🎉 YOU WIN!";
            break;
        case "lose":
            bgColor = CONFIG.loseColor;
            textColor = "#FFFFFF";
            text = "💔 YOU LOSE";
            break;
        case "push":
            bgColor = CONFIG.pushColor;
            textColor = "#000000";
            text = "🤝 PUSH - TIE!";
            break;
        default:
            return;
    }

    // Banner background with rounded corners
    ctx.fillStyle = bgColor;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 20 * CONFIG.scale;
    ctx.shadowOffsetY = 5 * CONFIG.scale;

    const radius = CONFIG.borderRadius * CONFIG.scale;
    ctx.beginPath();
    ctx.moveTo(x + radius, bannerY);
    ctx.lineTo(x + width - radius, bannerY);
    ctx.arcTo(x + width, bannerY, x + width, bannerY + radius, radius);
    ctx.lineTo(x + width, bannerY + bannerHeight - radius);
    ctx.arcTo(x + width, bannerY + bannerHeight, x + width - radius, bannerY + bannerHeight, radius);
    ctx.lineTo(x + radius, bannerY + bannerHeight);
    ctx.arcTo(x, bannerY + bannerHeight, x, bannerY + bannerHeight - radius, radius);
    ctx.lineTo(x, bannerY + radius);
    ctx.arcTo(x, bannerY, x + radius, bannerY, radius);
    ctx.closePath();
    ctx.fill();

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Banner text
    ctx.font = `${CONFIG.fontBold} ${CONFIG.subtitleFontSize * CONFIG.scale}px ${CONFIG.fontFamily}`;
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + width / 2, bannerY + bannerHeight / 2);

    // Reset text alignment
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
}

/**
 * Draw a hand of cards with label
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} hand
 * @param {number} yPosition
 * @param {string} label
 */
async function drawHand(ctx, hand, yPosition, label) {
    const { cards, value, busted, blackjack, bet } = hand;

    // Normalize and validate cards (supports both "2S" and "2_of_spades" formats)
    const normalizedCards = [];
    for (const cardName of cards) {
        try {
            const normalized = normalizeCardName(cardName);
            normalizedCards.push(normalized);
        } catch (error) {
            logger.error("Invalid card in hand", {
                scope: "renderBlackjack",
                card: cardName,
                error: error.message
            });
            throw error;
        }
    }

    // Draw label with value
    let labelText = `${label}`;
    let valueText = `${value}`;

    if (blackjack) valueText += " 🎯 BLACKJACK";
    if (busted) valueText += " 💥 BUSTED";

    let labelColor = CONFIG.textPrimary;
    let valueColor = CONFIG.textSecondary;
    if (blackjack) valueColor = CONFIG.winColor;
    if (busted) valueColor = CONFIG.loseColor;

    // Label (player name or "Dealer")
    ctx.font = `${CONFIG.fontBold} ${FONT_SIZE}px ${CONFIG.fontFamily}`;
    drawTextWithShadow(ctx, labelText, CARD_SPACING, yPosition - CARD_SPACING / 2, labelColor, false);

    // Value with glow if blackjack
    ctx.font = `${FONT_SIZE}px ${CONFIG.fontFamily}`;
    const labelWidth = ctx.measureText(labelText).width;
    drawTextWithShadow(ctx, valueText, CARD_SPACING + labelWidth + 15, yPosition - CARD_SPACING / 2, valueColor, blackjack);

    // Bet amount (if present)
    if (bet) {
        const betText = `💰 $${bet.toLocaleString()}`;
        ctx.font = `${FONT_SIZE * 0.85}px ${CONFIG.fontFamily}`;
        drawTextWithShadow(ctx, betText, CARD_SPACING, yPosition - CARD_SPACING / 4, CONFIG.chipColor);
    }

    // Draw cards with enhanced shadows
    for (let i = 0; i < normalizedCards.length; i++) {
        const cardImage = await loadCardImage(normalizedCards[i]);

        const x = CARD_SPACING + i * (CARD_WIDTH + CARD_SPACING / 2.2);

        // Deep card shadow
        ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
        ctx.shadowBlur = 12 * CONFIG.scale;
        ctx.shadowOffsetX = 4 * CONFIG.scale;
        ctx.shadowOffsetY = 6 * CONFIG.scale;

        ctx.drawImage(cardImage, x, yPosition, CARD_WIDTH, CARD_HEIGHT);

        // Slight overlap for multiple cards
        if (i > 0) {
            // No additional action needed, overlap is handled by positioning
        }
    }

    // Reset shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

/**
 * Render a complete blackjack table image
 *
 * @param {Object} params
 * @param {string} params.playerName - Player's display name
 * @param {string[]} params.dealerCards - Array of dealer card names
 * @param {number} params.dealerValue - Dealer hand value
 * @param {boolean} [params.dealerBusted=false] - Dealer busted
 * @param {boolean} [params.dealerBlackjack=false] - Dealer has blackjack
 * @param {Array<Object>} params.playerHands - Array of player hands (supports splits)
 * @param {string[]} params.playerHands[].cards - Cards in this hand
 * @param {number} params.playerHands[].value - Hand value
 * @param {boolean} [params.playerHands[].busted=false] - Hand busted
 * @param {boolean} [params.playerHands[].blackjack=false] - Hand is blackjack
 * @param {number} [params.playerHands[].bet] - Bet amount for this hand
 * @param {string} [params.result] - Overall result: "win", "lose", "push", null
 * @param {string} [params.title="Blackjack"] - Custom title
 *
 * @returns {Promise<Buffer>} PNG image buffer
 *
 * @example
 * // Simple single hand
 * const buffer = await renderBlackjackTable({
 *   playerName: "Player1",
 *   dealerCards: ["king_of_hearts", "7_of_clubs"],
 *   dealerValue: 17,
 *   playerHands: [{
 *     cards: ["ace_of_spades", "queen_of_diamonds"],
 *     value: 21,
 *     blackjack: true,
 *     bet: 1000
 *   }],
 *   result: "win"
 * });
 *
 * @example
 * // Split hands
 * const buffer = await renderBlackjackTable({
 *   playerName: "Player1",
 *   dealerCards: ["8_of_hearts", "9_of_clubs"],
 *   dealerValue: 17,
 *   playerHands: [
 *     { cards: ["ace_of_spades", "king_of_spades"], value: 21, bet: 1000 },
 *     { cards: ["ace_of_hearts", "5_of_hearts"], value: 16, bet: 1000 }
 *   ]
 * });
 */
async function renderBlackjackTable(params) {
    try {
        // Validate input
        if (!params || typeof params !== "object") {
            throw new Error("Invalid params: must be an object");
        }

        const {
            playerName,
            dealerCards = [],
            dealerValue = 0,
            dealerBusted = false,
            dealerBlackjack = false,
            playerHands = [],
            result = null,
            title = "🃏 Blackjack"
        } = params;

        if (!playerName) {
            throw new Error("playerName is required");
        }

        if (!Array.isArray(dealerCards) || dealerCards.length === 0) {
            throw new Error("dealerCards must be a non-empty array");
        }

        if (!Array.isArray(playerHands) || playerHands.length === 0) {
            throw new Error("playerHands must be a non-empty array");
        }

        // Calculate canvas dimensions
        const { width, height } = calculateCanvasDimensions(params);

        // Create high-resolution canvas (retina)
        const canvas = createCanvas(width * CONFIG.scaleFactor, height * CONFIG.scaleFactor);
        const ctx = canvas.getContext("2d");
        ctx.scale(CONFIG.scaleFactor, CONFIG.scaleFactor);

        // Quality settings
        ctx.antialias = "subpixel";
        ctx.patternQuality = "best";
        ctx.quality = "best";
        ctx.textDrawingMode = "path";

        // Draw background
        drawTableBackground(ctx, width, height);

        // Draw title
        ctx.font = `${CONFIG.fontBold} ${TITLE_FONT_SIZE}px ${CONFIG.fontFamily}`;
        let titleColor = CONFIG.textPrimary;
        if (result === "win") titleColor = CONFIG.winColor;
        if (result === "lose") titleColor = CONFIG.loseColor;
        if (result === "push") titleColor = CONFIG.pushColor;

        drawTextWithShadow(ctx, title, CARD_SPACING, TITLE_FONT_SIZE + CARD_SPACING / 2, titleColor, true);

        let currentY = TITLE_FONT_SIZE + CARD_SPACING * 2;

        // Result banner (if game is finished)
        if (result) {
            drawResultBanner(ctx, result, CARD_SPACING, currentY, width - CARD_SPACING * 2);
            currentY += 70 * CONFIG.scale;
        }

        // Draw dealer hand
        const dealerHand = {
            cards: dealerCards,
            value: dealerValue,
            busted: dealerBusted,
            blackjack: dealerBlackjack
        };
        await drawHand(ctx, dealerHand, currentY, "Dealer");

        currentY += CARD_HEIGHT + CARD_SPACING * 2.5;

        // Draw golden divider between dealer and player
        drawDivider(ctx, currentY, width);

        currentY += CARD_SPACING;

        // Draw player hands
        for (let i = 0; i < playerHands.length; i++) {
            const hand = playerHands[i];
            const handLabel = playerHands.length > 1
                ? `${playerName} (Hand ${i + 1})`
                : playerName;

            await drawHand(ctx, hand, currentY, handLabel);
            currentY += CARD_HEIGHT + CARD_SPACING * 2;
        }

        // Convert to buffer
        const baseBuffer = canvas.toBuffer("image/png");

        // Optional: High-quality downscaling with Sharp
        if (sharp) {
            return await sharp(baseBuffer)
                .resize({
                    width: Math.round(width),
                    height: Math.round(height),
                    kernel: sharp.kernel.lanczos3
                })
                .png({ quality: 100, compressionLevel: 6 })
                .toBuffer();
        }

        return baseBuffer;

    } catch (error) {
        logger.error("Failed to render blackjack table", {
            scope: "renderBlackjack",
            error: error.message,
            stack: error.stack
        });
        throw error;
    }
}

/**
 * Clear the image cache (useful for testing or memory management)
 */
function clearImageCache() {
    imageCache.clear();
    logger.debug("Image cache cleared", { scope: "renderBlackjack" });
}

/**
 * Preload commonly used cards into cache
 * @param {string[]} cardNames - Array of card names to preload
 */
async function preloadCards(cardNames) {
    const promises = cardNames.map(name => loadCardImage(name).catch(() => null));
    await Promise.all(promises);
    logger.debug(`Preloaded ${imageCache.size} cards into cache`, { scope: "renderBlackjack" });
}

module.exports = {
    renderBlackjackTable,
    clearImageCache,
    preloadCards,
    CONFIG
};
