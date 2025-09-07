const fs = require("fs/promises");
const path = require("path");
const logger = require("../utils/logger");
const { gameToImage, isValidGameCard } = require("../utils/cardConverter");
const {
    SceneNodeType,
    createScene,
    createNode,
    addNode
} = require("./sceneGraph");
let sharp;

try {
    sharp = require("sharp");
} catch (error) {
    logger.debug("Sharp not installed - SVG output only", {
        scope: "cardTableRenderer",
        message: error.message
    });
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    scale: 0.75,
    cardWidth: 138,
    cardHeight: 198,
    cardSpacing: 50,
    fontSize: 34,
    titleFontSize: 54,
    subtitleFontSize: 40,
    fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    fontBold: "700",
    tableFeltDark: "#0A2E1F",
    tableFeltLight: "#0F4A2E",
    tableFeltAccent: "#1A5C3A",
    dividerColor: "#D4AF37",
    textPrimary: "#FFFFFF",
    textSecondary: "#E0E0E0",
    textShadow: "rgba(0, 0, 0, 0.85)",
    winColor: "#4CAF50",
    loseColor: "#F44336",
    pushColor: "#FFC107",
    chipColor: "#DC143C",
    borderColor: "#2E7D5A",
    cardsPath: path.join(__dirname, "../../assets/cards")
};

const CARD_BASE_WIDTH = CONFIG.cardWidth;
const CARD_BASE_HEIGHT = CONFIG.cardHeight;
const CARD_WIDTH = CARD_BASE_WIDTH * CONFIG.scale;
const CARD_HEIGHT = CARD_BASE_HEIGHT * CONFIG.scale;
const CARD_SPACING = CONFIG.cardSpacing * CONFIG.scale;
const FONT_SIZE = CONFIG.fontSize * CONFIG.scale;
const NAME_FONT_SIZE = FONT_SIZE * 1.12;
const VALUE_FONT_SIZE = FONT_SIZE * 0.98;
const TITLE_FONT_SIZE = CONFIG.titleFontSize * CONFIG.scale;
const CARD_OVERLAP = CARD_SPACING / 2.2;

const LAYOUT = Object.freeze({
    canvasWidth: 1024,
    minWidth: 880 * CONFIG.scale,
    maxPlayerColumns: 3,
    sidePadding: CARD_SPACING * 1.2,
    columnGap: CARD_SPACING * 1.5,
    rowGap: CARD_SPACING * 1.5,
    handHorizontalPadding: CARD_SPACING * 0.9,
    handVerticalPadding: CARD_SPACING * 0.6,
    handHeaderHeight: NAME_FONT_SIZE * 2.2,
    handFooterHeight: FONT_SIZE * 1.6,
    dividerGap: CARD_SPACING * 1.8,
    bannerHeight: 60 * CONFIG.scale,
    bottomPadding: CARD_SPACING * 2,
    minHandScale: 0.68,
    labelGap: CARD_SPACING * 0.6
});

const DEFAULT_PALETTE = Object.freeze({
    tableFeltDark: CONFIG.tableFeltDark,
    tableFeltLight: CONFIG.tableFeltLight,
    tableFeltAccent: CONFIG.tableFeltAccent,
    dividerColor: CONFIG.dividerColor,
    textPrimary: CONFIG.textPrimary,
    textSecondary: CONFIG.textSecondary,
    textShadow: CONFIG.textShadow,
    winColor: CONFIG.winColor,
    loseColor: CONFIG.loseColor,
    pushColor: CONFIG.pushColor,
    chipColor: CONFIG.chipColor,
    borderColor: CONFIG.borderColor
});

const THEMES = {
    "casino-classic": {},
    "midnight-blue": {
        tableFeltDark: "#071527",
        tableFeltLight: "#0F2741",
        dividerColor: "#4FC3F7",
        textPrimary: "#E3F2FD",
        textSecondary: "#B3E5FC",
        textShadow: "rgba(0, 0, 0, 0.9)",
        winColor: "#66BB6A",
        loseColor: "#EF5350",
        pushColor: "#FFB74D",
        chipColor: "#FF5252",
        borderColor: "#1E88E5"
    },
    "royal-velvet": {
        tableFeltDark: "#1F0A2E",
        tableFeltLight: "#33124D",
        dividerColor: "#F3E5AB",
        textPrimary: "#FCE4EC",
        textSecondary: "#F8BBD0",
        textShadow: "rgba(0, 0, 0, 0.85)",
        winColor: "#C5E1A5",
        loseColor: "#E57373",
        pushColor: "#FFD54F",
        chipColor: "#FF6F61",
        borderColor: "#8E24AA"
    }
};

// ============================================================================
// CARD IMAGE CACHE
// ============================================================================

const cardImageCache = new Map();

async function loadCardImage(cardName) {
    if (cardImageCache.has(cardName)) {
        return cardImageCache.get(cardName);
    }

    const cardPath = path.join(CONFIG.cardsPath, `${cardName}.png`);

    try {
        const file = await fs.readFile(cardPath);
        const dataUri = `data:image/png;base64,${file.toString("base64")}`;
        cardImageCache.set(cardName, dataUri);
        return dataUri;
    } catch (error) {
        logger.error("Failed to load card asset", {
            scope: "cardTableRenderer",
            cardName,
            cardPath,
            error: error.message
        });
        throw new Error(`Card asset not found: ${cardName}`);
    }
}

function clearImageCache() {
    cardImageCache.clear();
}

async function preloadCards(cardNames) {
    await Promise.all(
        (cardNames ?? []).map(name => loadCardImage(name).catch(() => null))
    );
}

// ============================================================================
// LAYOUT HELPERS
// ============================================================================

function normalizeCardName(cardName) {
    if (!cardName || typeof cardName !== "string") {
        throw new Error(`Invalid card name: ${cardName}`);
    }

    if (cardName.length === 2 && isValidGameCard(cardName)) {
        return gameToImage(cardName);
    }

    return cardName;
}

function getCardsWidth(cardCount, cardWidth = CARD_WIDTH, overlap = CARD_OVERLAP) {
    if (!cardCount || cardCount <= 1) {
        return cardWidth;
    }
    return cardWidth * cardCount + overlap * (cardCount - 1);
}

function computeTableLayout(params) {
    const { dealerCards = [], playerHands = [], result = null } = params;

    const dealerCardCount = Math.max(1, dealerCards.length);
    const playerCardCounts = playerHands.map(hand => Array.isArray(hand?.cards) ? hand.cards.length : 0);
    const maxPlayerCards = Math.max(1, ...playerCardCounts);

    const rawPlayerHandWidth = getCardsWidth(maxPlayerCards) + LAYOUT.handHorizontalPadding * 2;
    const rawDealerHandWidth = getCardsWidth(dealerCardCount) + LAYOUT.handHorizontalPadding * 2;

    const playerCount = Math.max(1, playerHands.length);
    const columns = Math.min(LAYOUT.maxPlayerColumns, playerCount);
    const rows = Math.ceil(playerCount / columns);

    const handHeaderHeight = LAYOUT.handHeaderHeight;
    const handFooterHeight = LAYOUT.handFooterHeight;
    const totalHandHeight = handHeaderHeight + CARD_HEIGHT + handFooterHeight;

    const width = LAYOUT.canvasWidth ?? Math.max(LAYOUT.minWidth, 900 * CONFIG.scale);
    const availableWidth = width - LAYOUT.sidePadding * 2;

    let playerHandWidth = rawPlayerHandWidth;
    let playerColumnGap = LAYOUT.columnGap;

    if (playerHands.length > 0) {
        const totalWidth = rawPlayerHandWidth * columns + playerColumnGap * (columns - 1);
        if (totalWidth > availableWidth) {
            const compression = availableWidth / totalWidth;
            playerHandWidth = rawPlayerHandWidth * compression;
            playerColumnGap = playerColumnGap * compression;
        }
    }

    let dealerHandWidth = Math.min(rawDealerHandWidth, availableWidth);

    const totalHandsWidth = playerHands.length > 0
        ? playerHandWidth * columns + playerColumnGap * (columns - 1)
        : dealerHandWidth;

    const innerWidth = width - LAYOUT.sidePadding * 2;
    const playerLeftOffset = playerHands.length > 0
        ? LAYOUT.sidePadding + Math.max(0, (availableWidth - totalHandsWidth) / 2)
        : LAYOUT.sidePadding + Math.max(0, (availableWidth - dealerHandWidth) / 2);
    const dealerLeftOffset = LAYOUT.sidePadding + Math.max(0, (availableWidth - dealerHandWidth) / 2);

    const titlePosition = {
        x: LAYOUT.sidePadding,
        y: TITLE_FONT_SIZE + CARD_SPACING * 0.4
    };

    let currentY = TITLE_FONT_SIZE + CARD_SPACING * 1.2;
    let bannerFrame = null;

    if (result) {
        const bannerWidth = Math.min(innerWidth, width - LAYOUT.sidePadding * 0.5);
        bannerFrame = {
            x: (width - bannerWidth) / 2,
            y: currentY,
            width: bannerWidth,
            height: LAYOUT.bannerHeight
        };
        currentY += LAYOUT.bannerHeight + CARD_SPACING * 0.8;
    }

    const dealerBoundsY = currentY;
    const dealerCardsAreaY = dealerBoundsY + handHeaderHeight;
    const dealerLayout = {
        bounds: {
            x: dealerLeftOffset,
            y: dealerBoundsY,
            width: dealerHandWidth,
            height: totalHandHeight
        },
        cardsArea: {
            x: dealerLeftOffset + LAYOUT.handHorizontalPadding,
            y: dealerCardsAreaY,
            width: dealerHandWidth - LAYOUT.handHorizontalPadding * 2,
            height: CARD_HEIGHT
        },
        headerArea: {
            x: dealerLeftOffset + LAYOUT.handHorizontalPadding,
            y: dealerBoundsY,
            width: dealerHandWidth - LAYOUT.handHorizontalPadding * 2,
            height: handHeaderHeight
        },
        footerArea: {
            x: dealerLeftOffset + LAYOUT.handHorizontalPadding,
            y: dealerCardsAreaY + CARD_HEIGHT,
            width: dealerHandWidth - LAYOUT.handHorizontalPadding * 2,
            height: handFooterHeight
        },
        labelAnchor: {
            x: dealerLeftOffset + LAYOUT.handHorizontalPadding,
            y: dealerBoundsY + handHeaderHeight * 0.6
        },
        betAnchor: {
            x: dealerLeftOffset + LAYOUT.handHorizontalPadding,
            y: dealerBoundsY + handHeaderHeight * 0.85
        }
    };

    const dividerY = dealerBoundsY + totalHandHeight + LAYOUT.dividerGap;
    const playerStartY = dividerY + CARD_SPACING;
    const rowStride = totalHandHeight + LAYOUT.rowGap;

    const playerLayouts = playerHands.map((_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);

        const offsetX = playerLeftOffset + column * (playerHandWidth + playerColumnGap);
        const cardsAreaX = offsetX + LAYOUT.handHorizontalPadding;
        const cardsAreaWidth = playerHandWidth - LAYOUT.handHorizontalPadding * 2;
        const baseY = playerStartY + row * rowStride;
        const cardsAreaY = baseY + handHeaderHeight;

        return {
            bounds: {
                x: offsetX,
                y: baseY,
                width: playerHandWidth,
                height: totalHandHeight
            },
            cardsArea: {
                x: cardsAreaX,
                y: cardsAreaY,
                width: cardsAreaWidth,
                height: CARD_HEIGHT
            },
            headerArea: {
                x: cardsAreaX,
                y: baseY,
                width: cardsAreaWidth,
                height: handHeaderHeight
            },
            footerArea: {
                x: cardsAreaX,
                y: cardsAreaY + CARD_HEIGHT,
                width: cardsAreaWidth,
                height: handFooterHeight
            },
            labelAnchor: {
                x: cardsAreaX,
                y: baseY + handHeaderHeight * 0.6
            },
            betAnchor: {
                x: cardsAreaX,
                y: baseY + handHeaderHeight * 0.85
            },
            row,
            column
        };
    });

    const playersSectionHeight = playerHands.length > 0
        ? (rows - 1) * rowStride + totalHandHeight
        : 0;

    const minCanvasHeight = 520 * CONFIG.scale;
    const height = Math.max(
        playerStartY + playersSectionHeight + LAYOUT.bottomPadding,
        dividerY + LAYOUT.bottomPadding,
        minCanvasHeight
    );

    return {
        width,
        height,
        titlePosition,
        bannerFrame,
        dealerLayout,
        dividerY,
        playerLayouts,
        columns,
        rows,
        rowStride,
        metrics: {
            dealerCardCount,
            maxPlayerCards,
            playerHandWidth,
            dealerHandWidth,
            handHeaderHeight,
            handFooterHeight,
            totalHandHeight
        }
    };
}

// ============================================================================
// DATA HELPERS FOR GAME INTEGRATION
// ============================================================================

function inferHandResult(hand, dealerState = {}) {
    if (!hand) return null;

    const normalizeResult = value => typeof value === "string" ? value.toLowerCase() : value;

    if (hand.result) {
        return normalizeResult(hand.result);
    }
    if (hand.outcome) {
        return normalizeResult(hand.outcome);
    }
    if (hand.win === true || hand.won === true || hand.isWinner === true) {
        return "win";
    }
    if (hand.lose === true || hand.lost === true || hand.isLoser === true) {
        return "lose";
    }
    if (hand.push || hand.tied || hand.tie) {
        return "push";
    }

    const hasBlackjack = Boolean(hand.blackjack || hand.isBlackjack || hand.BJ);
    const busted = Boolean(hand.busted || hand.isBusted);
    if (busted) {
        return "lose";
    }

    const dealerBlackjack = Boolean(dealerState.blackjack || dealerState.hasBlackjack || dealerState.BJ);
    const dealerBusted = Boolean(dealerState.busted || dealerState.isBusted);

    if (dealerBlackjack) {
        if (hasBlackjack) return "push";
        return "lose";
    }

    if (hasBlackjack) {
        return "win";
    }

    if (dealerBusted) {
        return "win";
    }

    const handValue = Number.isFinite(hand.value) ? hand.value
        : Number.isFinite(hand.total) ? hand.total
        : Number.isFinite(hand.score) ? hand.score
        : null;
    const dealerValue = Number.isFinite(dealerState.value) ? dealerState.value
        : Number.isFinite(dealerState.total) ? dealerState.total
        : null;

    if (!Number.isFinite(handValue) || !Number.isFinite(dealerValue)) {
        return null;
    }

    if (handValue > dealerValue) return "win";
    if (handValue < dealerValue) return "lose";
    return "push";
}

function resolvePlayerLabel(player, index = 0) {
    return (
        player?.displayName
        || player?.username
        || player?.tag
        || player?.name
        || player?.user?.username
        || `Player ${index + 1}`
    );
}

/**
 * Normalize a blackjack game snapshot into renderer-ready params.
 *
 * @param {Object} gameState - Raw game state (dealer, players, etc.)
 * @param {Object} [options]
 * @param {string} [options.focusPlayerId] - Highlighted player id
 * @param {string} [options.playerName] - Override primary player name
 * @param {string} [options.result] - Override overall result (win/lose/push)
 * @param {string} [options.title] - Custom title for the render
 * @param {Object} [options.appearance] - Appearance overrides compatible with resolveAppearance()
 * @returns {Object} Renderer params compatible with renderCardTable
 */
function createBlackjackTableState(gameState = {}, options = {}) {
    const dealerState = gameState.dealer ?? {};
    const players = Array.isArray(gameState.players) ? gameState.players : [];
    const focusPlayerId = options.focusPlayerId;
    const maskDealerHoleCard = Boolean(options.maskDealerHoleCard);

    const normalizedDealer = {
        cards: dealerState.cards ?? [],
        value: dealerState.value ?? dealerState.total ?? dealerState.score ?? 0,
        busted: Boolean(dealerState.busted || dealerState.status === "busted" || dealerState.isBusted),
        blackjack: Boolean(dealerState.blackjack || dealerState.hasBlackjack || dealerState.BJ)
    };

    const playerHands = [];
    players.forEach((player, playerIndex) => {
        const hands = Array.isArray(player?.hands) ? player.hands : [];
        const displayName = resolvePlayerLabel(player, playerIndex);
        hands.forEach((hand, handIndex) => {
            if (!hand) return;
            playerHands.push({
                cards: hand.cards ?? [],
                value: hand.value ?? hand.total ?? hand.score ?? 0,
                bet: hand.bet ?? hand.wager ?? hand.stake ?? null,
                blackjack: Boolean(hand.blackjack || hand.isBlackjack || hand.BJ),
                busted: Boolean(hand.busted || hand.isBusted),
                push: Boolean(hand.push || hand.tied || hand.tie),
                label: hands.length > 1 ? `${displayName} (Hand ${handIndex + 1})` : displayName,
                playerName: displayName,
                result: inferHandResult(hand, normalizedDealer),
                payout: hand.payout ?? hand.net ?? hand.netWinning ?? null,
                playerId: player?.id
            });
        });
    });

    const focusPlayer = players.find(p => p?.id && p.id === focusPlayerId) || players[0] || null;
    const playerName = options.playerName
        || resolvePlayerLabel(focusPlayer, 0)
        || (playerHands[0]?.playerName ?? "Player");

    const allResults = playerHands
        .map(hand => hand.result)
        .filter(Boolean);
    const result = options.result
        || (allResults.length > 0 && allResults.every(res => res === allResults[0]) ? allResults[0] : null);

    return {
        playerName,
        dealerCards: normalizedDealer.cards,
        dealerValue: normalizedDealer.value,
        dealerBusted: normalizedDealer.busted,
        dealerBlackjack: normalizedDealer.blackjack,
        playerHands,
        result,
        title: options.title ?? options.defaultTitle ?? null,
        appearance: options.appearance ?? {},
        metadata: {
            focusPlayerId,
            round: options.round ?? gameState.round ?? null,
            tableId: options.tableId ?? gameState.id ?? null,
            maskDealerHoleCard
        }
    };
}

// ============================================================================
// APPEARANCE
// ============================================================================

function getPalette(themeKey = "casino-classic") {
    const overrides = THEMES[themeKey] ?? THEMES["casino-classic"] ?? {};
    return {
        ...DEFAULT_PALETTE,
        ...overrides
    };
}

function resolveAppearance(appearance = {}) {
    const themeKey = appearance.theme || "casino-classic";
    const noiseConfig = appearance.noise ?? {};

    const enabled = noiseConfig.enabled ?? true;
    const density = Number.isFinite(noiseConfig.density) && noiseConfig.density > 0
        ? noiseConfig.density
        : 8000;
    const intensity = Number.isFinite(noiseConfig.intensity) && noiseConfig.intensity >= 0
        ? Math.min(noiseConfig.intensity, 1)
        : 0.18;

    return {
        theme: themeKey,
        palette: getPalette(themeKey),
        noise: {
            enabled,
            density,
            intensity
        }
    };
}

function normalizeTableRenderRequest(params) {
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
        title = null,
        appearance = {},
        metadata = {},
        outputFormat,
        format,
        imageFormat
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

    const sanitizedParams = {
        playerName,
        dealerCards,
        dealerValue,
        dealerBusted,
        dealerBlackjack,
        playerHands,
        result,
        title,
        metadata
    };

    const appearanceOptions = resolveAppearance(appearance);
    const requestedFormat = String(outputFormat || format || imageFormat || "png").toLowerCase();

    return {
        sanitizedParams,
        appearanceOptions,
        requestedFormat
    };
}

// ============================================================================
// SCENE BUILDING
// ============================================================================

function buildCardTableScene(params, appearance) {
    const {
        playerName,
        dealerCards = [],
        dealerValue = 0,
        dealerBusted = false,
        dealerBlackjack = false,
        playerHands = [],
        result = null,
        title = null
    } = params;

    const focusPlayerId = params.metadata?.focusPlayerId ?? params.focusPlayerId ?? null;
    const maskDealerHoleCard = Boolean(params.metadata?.maskDealerHoleCard);

    const normalizedDealerCards = dealerCards.map(normalizeCardName);
    const normalizedPlayerHands = playerHands.map(hand => ({
        ...hand,
        cards: (hand.cards ?? []).map(normalizeCardName)
    }));

    const layout = computeTableLayout({
        dealerCards: normalizedDealerCards,
        playerHands: normalizedPlayerHands,
        result
    });

    const inheritedMetadata = {
        ...params.metadata,
        game: params.metadata?.game ?? "blackjack",
        result,
        playerName,
        playerCount: normalizedPlayerHands.length,
        title,
        theme: appearance.theme,
        palette: appearance.palette,
        layout: {
            columns: layout.columns,
            rows: layout.rows,
            rowStride: layout.rowStride
        }
    };

    const scene = createScene({
        width: layout.width,
        height: layout.height,
        metadata: inheritedMetadata,
        background: {
            type: "felt",
            theme: appearance.theme,
            palette: appearance.palette,
            noise: appearance.noise
        }
    });

    if (title) {
        inheritedMetadata.title = title;
    }

    if (layout.bannerFrame && result) {
        addNode(scene, createNode(SceneNodeType.BANNER, {
            result,
            frame: layout.bannerFrame
        }));
    }

    addNode(scene, createNode(SceneNodeType.HAND, {
        role: "dealer",
        label: "Dealer",
        hand: {
            cards: normalizedDealerCards,
            value: dealerValue,
            busted: dealerBusted,
            blackjack: dealerBlackjack
        },
        layout: layout.dealerLayout,
        maskHoleCard: maskDealerHoleCard
    }));

    addNode(scene, createNode(SceneNodeType.DIVIDER, {
        y: layout.dividerY
    }));

    layout.playerLayouts.forEach((handLayout, index) => {
        const hand = normalizedPlayerHands[index];
        if (!hand) return;

        const owner = hand.playerName || playerName;
        const customLabel = hand.label || hand.displayName;
        const label = customLabel
            || (normalizedPlayerHands.length > 1 ? `${owner} (Hand ${index + 1})` : owner);
        const isFocused = Boolean(focusPlayerId && hand.playerId && String(hand.playerId) === String(focusPlayerId));

        addNode(scene, createNode(SceneNodeType.HAND, {
            role: "player",
            label,
            hand,
            layout: handLayout,
            playerIndex: index,
            row: handLayout.row,
            column: handLayout.column,
            isFocused
        }));
    });

    return { scene, layout };
}

// ============================================================================
// SVG RENDERING
// ============================================================================

function formatNumber(value) {
    return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.00$/, "");
}

function escapeXML(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function estimateTextWidth(text, fontSize, weight = "normal") {
    const weightFactor = weight === CONFIG.fontBold ? 0.62 : 0.55;
    return text.length * fontSize * weightFactor;
}

function svgText({
    x,
    y,
    text,
    color,
    fontSize,
    fontWeight = "400",
    glow = false,
    anchor = "start",
    baseline = "alphabetic",
    palette = DEFAULT_PALETTE,
    shadow = true
}) {
    const safe = escapeXML(text);
    const lines = [];

    if (shadow) {
        lines.push(
            `<text x="${formatNumber(x + 1.4)}" y="${formatNumber(y + 1.8)}" fill="${palette.textShadow}" font-size="${formatNumber(fontSize)}" font-family="${escapeXML(CONFIG.fontFamily)}" font-weight="${fontWeight}" opacity="0.55" dominant-baseline="${baseline}" text-anchor="${anchor}">${safe}</text>`
        );
    }

    const glowStyle = glow
        ? ` style="paint-order: stroke; stroke:${color}; stroke-width:${formatNumber(fontSize * 0.18)}; stroke-linejoin:round;"`
        : "";

    lines.push(
        `<text x="${formatNumber(x)}" y="${formatNumber(y)}" fill="${color}" font-size="${formatNumber(fontSize)}" font-family="${escapeXML(CONFIG.fontFamily)}" font-weight="${fontWeight}" dominant-baseline="${baseline}" text-anchor="${anchor}"${glowStyle}>${safe}</text>`
    );

    return lines.join("\n");
}

function buildBackgroundDefs(uid, width, height, palette, noise) {
    const defs = [];

    const feltGradientId = uid("felt");
    defs.push(
        `<linearGradient id="${feltGradientId}" x1="0" y1="0" x2="0" y2="${formatNumber(height)}" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="${palette.tableFeltDark}" />
            <stop offset="55%" stop-color="${palette.tableFeltLight}" />
            <stop offset="100%" stop-color="${palette.tableFeltDark}" />
        </linearGradient>`
    );

    const spotlightGradientId = uid("spotlight");
    defs.push(
        `<radialGradient id="${spotlightGradientId}" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.12)" />
            <stop offset="60%" stop-color="rgba(255,255,255,0.04)" />
            <stop offset="100%" stop-color="rgba(0,0,0,0.25)" />
        </radialGradient>`
    );

    let noiseFilterId = null;
    if (noise?.enabled) {
        const baseFrequency = Math.max(0.02, Math.min(0.5, 2400 / noise.density));
        const noiseOpacity = Math.min(0.35, Math.max(0.05, noise.intensity));
        noiseFilterId = uid("noise");
        defs.push(
            `<filter id="${noiseFilterId}" x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="${baseFrequency}" numOctaves="3" seed="7" result="noise" />
                <feColorMatrix type="saturate" values="0.4" />
                <feComponentTransfer>
                    <feFuncA type="linear" slope="${noiseOpacity}" />
                </feComponentTransfer>
            </filter>`
        );
    }

    const cardShadowId = uid("card-shadow");
    defs.push(
        `<filter id="${cardShadowId}" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="3" dy="5" stdDeviation="3" flood-color="rgba(0,0,0,0.48)" />
        </filter>`
    );

    return { defs, feltGradientId, spotlightGradientId, noiseFilterId, cardShadowId };
}

function renderHandNode(node, palette, cardShadowId, cardAssets) {
    const { hand, layout, label } = node;
    const { cardsArea } = layout;
    const headerArea = layout.headerArea ?? {
        x: cardsArea.x,
        y: cardsArea.y - LAYOUT.handHeaderHeight,
        width: cardsArea.width,
        height: LAYOUT.handHeaderHeight
    };
    const footerArea = layout.footerArea ?? {
        x: cardsArea.x,
        y: cardsArea.y + CARD_HEIGHT,
        width: cardsArea.width,
        height: LAYOUT.handFooterHeight
    };
    const fragments = [];

    const cardsInHand = Array.isArray(hand.cards) ? hand.cards : [];
    const cardCount = cardsInHand.length;
    const cardsWidth = getCardsWidth(cardCount);
    const desiredScale = cardsArea.width < cardsWidth
        ? Math.max(LAYOUT.minHandScale, cardsArea.width / cardsWidth)
        : 1;

    const cardWidth = CARD_WIDTH * desiredScale;
    const cardHeight = CARD_HEIGHT * desiredScale;
    const spacing = CARD_OVERLAP * desiredScale;
    const totalCardWidth = cardCount > 0
        ? cardWidth * cardCount + spacing * (cardCount - 1)
        : cardWidth;

    const startX = cardsArea.x + Math.max(0, (cardsArea.width - totalCardWidth) / 2);
    const cardY = cardsArea.y;

    const rawLabelText = label ?? "Player";
    const labelColor = palette.textPrimary ?? CONFIG.textPrimary;
    const textInset = Math.max(LAYOUT.handHorizontalPadding * 0.6, CARD_SPACING * 0.05);
    const headerLeft = headerArea.x + textInset;
    const headerRight = headerArea.x + headerArea.width - textInset;
    const labelBaseline = headerArea.y + Math.min(FONT_SIZE, headerArea.height * 0.5);
    const infoBaseline = footerArea.y + Math.min(footerArea.height * 0.55, footerArea.height - FONT_SIZE * 0.32);

    const availableHeaderWidth = headerRight - headerLeft;
    const minNameSlot = Math.max(160 * CONFIG.scale, availableHeaderWidth * 0.4);
    const minValueSlot = Math.max(140 * CONFIG.scale, availableHeaderWidth * 0.25);
    let valueSlotWidth = Math.max(
        minValueSlot,
        Math.min(availableHeaderWidth * 0.4, availableHeaderWidth - minNameSlot - LAYOUT.labelGap)
    );
    if (valueSlotWidth < 0) valueSlotWidth = minValueSlot;
    let nameSlotWidth = availableHeaderWidth - valueSlotWidth - LAYOUT.labelGap;
    if (nameSlotWidth < minNameSlot) {
        nameSlotWidth = Math.max(minNameSlot, availableHeaderWidth - minValueSlot - LAYOUT.labelGap);
        valueSlotWidth = Math.max(minValueSlot, availableHeaderWidth - nameSlotWidth - LAYOUT.labelGap);
        if (valueSlotWidth < 0) {
            valueSlotWidth = Math.max(minValueSlot * 0.5, availableHeaderWidth * 0.3);
            nameSlotWidth = Math.max(availableHeaderWidth - valueSlotWidth - LAYOUT.labelGap, minNameSlot * 0.6);
        }
    }

    const valueStartXBase = headerLeft + nameSlotWidth + LAYOUT.labelGap;
    const maxValueSlot = Math.max(0, headerRight - valueStartXBase);
    valueSlotWidth = Math.min(valueSlotWidth, maxValueSlot);

    let labelText = rawLabelText;
    let labelWidth = estimateTextWidth(labelText, NAME_FONT_SIZE, CONFIG.fontBold);
    const maxLabelWidth = nameSlotWidth;
    if (labelWidth > maxLabelWidth) {
        const approxCharWidth = NAME_FONT_SIZE * 0.6;
        const maxChars = Math.max(4, Math.floor(maxLabelWidth / approxCharWidth));
        if (labelText.length > maxChars) {
            labelText = `${labelText.slice(0, maxChars - 1)}…`;
            labelWidth = estimateTextWidth(labelText, NAME_FONT_SIZE, CONFIG.fontBold);
        }
    }

    fragments.push(svgText({
        x: headerLeft,
        y: labelBaseline,
        text: labelText,
        color: labelColor,
        fontSize: NAME_FONT_SIZE,
        fontWeight: CONFIG.fontBold,
        anchor: "start",
        palette
    }));

    const valueSegments = [];
    if (Number.isFinite(hand.value)) {
        valueSegments.push(`Value ${hand.value}`);
    }
    if (hand.blackjack) valueSegments.push("Blackjack");
    if (hand.busted) valueSegments.push("Busted");
    if (hand.push && !hand.busted && !hand.blackjack) valueSegments.push("Push");
    if (valueSegments.length === 0) {
        valueSegments.push("Value ??");
    }

    const uniqueValueSegments = [...new Set(valueSegments)];
    const valueText = uniqueValueSegments.join(" • ");
    const valueWidth = valueText ? estimateTextWidth(valueText, VALUE_FONT_SIZE, "600") : 0;

    let valueColor = palette.textSecondary ?? CONFIG.textSecondary;
    if (hand.blackjack) valueColor = palette.winColor ?? CONFIG.winColor;
    if (hand.busted) valueColor = palette.loseColor ?? CONFIG.loseColor;
    if (hand.push && !hand.busted && !hand.blackjack) valueColor = palette.pushColor ?? CONFIG.pushColor;
    const normalizedResult = typeof hand.result === "string" ? hand.result.toLowerCase() : null;
    if (normalizedResult === "win") valueColor = palette.winColor ?? CONFIG.winColor;
    if (normalizedResult === "lose") valueColor = palette.loseColor ?? CONFIG.loseColor;
    if (normalizedResult === "push") valueColor = palette.pushColor ?? CONFIG.pushColor;

    if (valueText) {
        const valueStartX = valueStartXBase;
        let valueX = valueStartX;
        let valueAnchor = "start";
        if (valueWidth > valueSlotWidth) {
            valueAnchor = "end";
            valueX = valueStartX + valueSlotWidth;
        }

        fragments.push(svgText({
            x: valueX,
            y: labelBaseline,
            text: valueText,
            color: valueColor,
            fontSize: VALUE_FONT_SIZE,
            fontWeight: "600",
            anchor: valueAnchor,
            palette
        }));
    }

    if (node.role === "player") {
        const result = hand.result?.toLowerCase?.();
        let badgeColor = null;
        let badgeText = null;
        if (result === "win") {
            badgeColor = palette.winColor ?? CONFIG.winColor;
            badgeText = "Win";
        } else if (result === "lose") {
            badgeColor = palette.loseColor ?? CONFIG.loseColor;
            badgeText = "Lose";
        } else if (result === "push") {
            badgeColor = palette.pushColor ?? CONFIG.pushColor;
            badgeText = "Push";
        }

        if (badgeColor && badgeText) {
            const badgePaddingX = Math.max(12 * CONFIG.scale, NAME_FONT_SIZE * 0.55);
            const badgePaddingY = Math.max(6 * CONFIG.scale, NAME_FONT_SIZE * 0.25);
            const textWidth = estimateTextWidth(badgeText, FONT_SIZE * 0.75, "700");
            const badgeWidth = textWidth + badgePaddingX * 2;
            const badgeHeight = FONT_SIZE * 0.75 + badgePaddingY;
            const badgeX = headerRight - badgeWidth;
            const badgeY = headerArea.y + (headerArea.height - badgeHeight) / 2;
            const radius = badgeHeight / 2;

            const badgeTextColor = result === "lose" ? "#FFF" : "#000";
            fragments.push(
                `<g transform="translate(${formatNumber(badgeX)}, ${formatNumber(badgeY)})">` +
                `<rect x="0" y="0" width="${formatNumber(badgeWidth)}" height="${formatNumber(badgeHeight)}" rx="${formatNumber(radius)}" ry="${formatNumber(radius)}" fill="${badgeColor}" opacity="0.9" />` +
                svgText({
                    x: badgeWidth / 2,
                    y: badgeHeight / 2 + FONT_SIZE * 0.12,
                    text: badgeText.toUpperCase(),
                    color: badgeTextColor,
                    fontSize: FONT_SIZE * 0.78,
                    fontWeight: CONFIG.fontBold,
                    anchor: "middle",
                    baseline: "middle",
                    shadow: false,
                    palette
                }) +
                `</g>`
            );
        }
    }

    const infoParts = [];
    if (hand.bet !== undefined && hand.bet !== null) {
        infoParts.push(`Bet $${Number(hand.bet).toLocaleString()}`);
    }
    if (Number.isFinite(hand.payout) && hand.payout !== 0) {
        const sign = hand.payout > 0 ? "+" : "-";
        infoParts.push(`Payout ${sign}$${Math.abs(hand.payout).toLocaleString()}`);
    }
    const xpValue = Number(hand.xp ?? hand.xpEarned);
    if (Number.isFinite(xpValue)) {
        const xpText = xpValue === 0
            ? "XP ±0"
            : `XP ${xpValue > 0 ? "+" : "-"}${Math.abs(xpValue).toLocaleString()}`;
        infoParts.push(xpText);
    }
    if (infoParts.length > 0) {
        fragments.push(svgText({
            x: cardsArea.x + cardsArea.width / 2,
            y: infoBaseline,
            text: infoParts.join("  •  "),
            color: palette.textSecondary ?? CONFIG.textSecondary,
            fontSize: FONT_SIZE * 0.7,
            fontWeight: "500",
            anchor: "middle",
            baseline: "middle",
            shadow: false,
            palette
        }));
    }

    cardsInHand.forEach((cardName, index) => {
        const hideCard = node.role === "dealer" && node.maskHoleCard && index === 1;
        const x = startX + index * (cardWidth + spacing);

        if (hideCard) {
            const radius = cardWidth * 0.12;
            const inset = cardWidth * 0.08;
            const innerRadius = radius * 0.7;
            const strokeColor = palette.borderColor ?? CONFIG.borderColor;
            const backPrimary = palette.tableFeltAccent ?? CONFIG.tableFeltAccent;
            const backSecondary = palette.tableFeltLight ?? CONFIG.tableFeltLight;

            fragments.push(
                `<g transform="translate(${formatNumber(x)}, ${formatNumber(cardY)})" filter="url(#${cardShadowId})">
                    <rect x="0" y="0" width="${formatNumber(cardWidth)}" height="${formatNumber(cardHeight)}" rx="${formatNumber(radius)}" ry="${formatNumber(radius)}" fill="${backPrimary}" stroke="${strokeColor}" stroke-width="${formatNumber(Math.max(1.2, cardWidth * 0.03))}" opacity="0.94" />
                    <rect x="${formatNumber(inset)}" y="${formatNumber(inset)}" width="${formatNumber(cardWidth - inset * 2)}" height="${formatNumber(cardHeight - inset * 2)}" rx="${formatNumber(innerRadius)}" ry="${formatNumber(innerRadius)}" fill="${backSecondary}" opacity="0.85" />
                    <path d="M ${formatNumber(cardWidth / 2)} ${formatNumber(inset * 1.2)} L ${formatNumber(cardWidth - inset * 1.4)} ${formatNumber(cardHeight / 2)} L ${formatNumber(cardWidth / 2)} ${formatNumber(cardHeight - inset * 1.2)} L ${formatNumber(inset * 1.4)} ${formatNumber(cardHeight / 2)} Z" fill="${strokeColor}" opacity="0.25" />
                </g>`
            );
            return;
        }

        const dataUri = cardAssets.get(cardName);
        if (!dataUri) {
            logger.warn("Missing card asset for render", {
                scope: "cardTableRenderer",
                cardName
            });
            return;
        }

        fragments.push(
            `<image href="${dataUri}" xlink:href="${dataUri}" x="${formatNumber(x)}" y="${formatNumber(cardY)}" width="${formatNumber(cardWidth)}" height="${formatNumber(cardHeight)}" preserveAspectRatio="xMidYMid slice" filter="url(#${cardShadowId})" />`
        );
    });

    return `<g>${fragments.join("\n")}</g>`;
}

async function renderSceneToSVG(scene, options = {}) {
    const palette = scene.metadata?.palette ?? DEFAULT_PALETTE;
    const width = scene.width;
    const height = scene.height;
    const background = scene.background ?? {};
    const noise = background.noise ?? { enabled: true, density: 8000, intensity: 0.18 };
    let cardAssets = options.cardAssets instanceof Map
        ? options.cardAssets
        : new Map(Object.entries(options.cardAssets ?? {}));

    if (!cardAssets || cardAssets.size === 0) {
        const neededCards = new Set();
        for (const node of scene.nodes) {
            if (node.type === SceneNodeType.HAND) {
                for (const cardName of node.hand?.cards ?? []) {
                    neededCards.add(cardName);
                }
            }
        }

        if (neededCards.size > 0) {
            const entries = await Promise.all(
                Array.from(neededCards, async cardName => [cardName, await loadCardImage(cardName)])
            );
            cardAssets = new Map(entries);
        }
    }

    let idCounter = 0;
    const uid = (prefix = "id") => `${prefix}-${++idCounter}`;

    const {
        defs,
        feltGradientId,
        spotlightGradientId,
        noiseFilterId,
        cardShadowId
    } = buildBackgroundDefs(uid, width, height, palette, noise);

    const body = [];

    body.push(
        `<rect x="0" y="0" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="url(#${feltGradientId})" />`
    );

    body.push(
        `<rect x="0" y="0" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="url(#${spotlightGradientId})" />`
    );

    if (noise?.enabled && noiseFilterId) {
        body.push(
            `<rect x="0" y="0" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="transparent" filter="url(#${noiseFilterId})" />`
        );
    }

    for (const node of scene.nodes) {
        switch (node.type) {
            case SceneNodeType.TITLE: {
                const { text, color, position, glow = false, align = "left" } = node;
                const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
                body.push(svgText({
                    x: position.x,
                    y: position.y,
                    text,
                    color,
                    fontSize: TITLE_FONT_SIZE,
                    fontWeight: CONFIG.fontBold,
                    glow,
                    anchor,
                    palette
                }));
                break;
            }
            case SceneNodeType.BANNER: {
                const { result, frame } = node;
                const bannerHeight = frame.height;

                let backgroundColor;
                let textColor;
                let text;
                switch (result) {
                    case "win":
                        backgroundColor = palette.winColor ?? CONFIG.winColor;
                        textColor = palette.textPrimary ?? "#FFFFFF";
                        text = "YOU WIN!";
                        break;
                    case "lose":
                        backgroundColor = palette.loseColor ?? CONFIG.loseColor;
                        textColor = palette.textPrimary ?? "#FFFFFF";
                        text = "YOU LOSE";
                        break;
                    case "push":
                    default:
                        backgroundColor = palette.pushColor ?? CONFIG.pushColor;
                        textColor = "#000000";
                        text = "PUSH - TIE!";
                        break;
                }

                const radius = 18 * CONFIG.scale;
                body.push(
                    `<rect x="${formatNumber(frame.x)}" y="${formatNumber(frame.y)}" width="${formatNumber(frame.width)}" height="${formatNumber(bannerHeight)}" rx="${formatNumber(radius)}" fill="${backgroundColor}" filter="url(#${cardShadowId})" />`
                );
                const bannerTextSize = CONFIG.subtitleFontSize * CONFIG.scale;
                const textY = frame.y + bannerHeight / 2 + bannerTextSize * 0.32;
                body.push(
                    `<text x="${formatNumber(frame.x + frame.width / 2)}" y="${formatNumber(textY)}" fill="${textColor}" font-size="${formatNumber(bannerTextSize)}" font-family="${escapeXML(CONFIG.fontFamily)}" font-weight="${CONFIG.fontBold}" text-anchor="middle">${escapeXML(text)}</text>`
                );
                break;
            }
            case SceneNodeType.DIVIDER: {
                const y = node.y - CARD_SPACING;
                const padding = CARD_SPACING * 2;
                body.push(
                    `<rect x="${formatNumber(padding)}" y="${formatNumber(y)}" width="${formatNumber(width - padding * 2)}" height="${formatNumber(CONFIG.scale * 3)}" fill="${palette.dividerColor}" opacity="0.9" />`
                );
                break;
            }
            case SceneNodeType.HAND: {
                body.push(renderHandNode(node, palette, cardShadowId, cardAssets));
                break;
            }
            default:
                break;
        }
    }

    const svg = [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${formatNumber(width)}" height="${formatNumber(height)}" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" shape-rendering="geometricPrecision">`,
        `<defs>`,
        defs.join("\n"),
        `</defs>`,
        body.join("\n"),
        `</svg>`
    ].join("\n");

    return svg;
}

// ============================================================================
// PUBLIC API
// ============================================================================

async function renderCardTable(params) {
    const context = normalizeTableRenderRequest(params);
    const svgBuffer = await renderCardTableSVG(context);

    if (context.requestedFormat === "svg") {
        return svgBuffer;
    }

    if (!sharp) {
        throw new Error("PNG output requested but 'sharp' module is not installed. Install sharp or pass outputFormat: 'svg'.");
    }

    return sharp(svgBuffer)
        .png({ compressionLevel: 6, quality: 100 })
        .toBuffer();
}

async function renderCardTableSVG(paramsOrContext) {
    const context = paramsOrContext?.sanitizedParams
        ? paramsOrContext
        : normalizeTableRenderRequest(paramsOrContext);

    const { sanitizedParams, appearanceOptions } = context;
    const { scene } = buildCardTableScene(sanitizedParams, appearanceOptions);

    const cardNames = new Set();
    for (const node of scene.nodes) {
        if (node.type === SceneNodeType.HAND) {
            for (const cardName of node.hand?.cards ?? []) {
                cardNames.add(cardName);
            }
        }
    }

    const cardEntries = await Promise.all(
        Array.from(cardNames, async cardName => [cardName, await loadCardImage(cardName)])
    );
    const cardAssets = new Map(cardEntries);

    const svg = await renderSceneToSVG(scene, { cardAssets });

    return Buffer.from(svg, "utf8");
}

module.exports = {
    renderCardTable,
    renderCardTableSVG,
    renderSceneToSVG,
    buildCardTableScene,
    resolveAppearance,
    createBlackjackTableState,
    preloadCards,
    clearImageCache,
    CONFIG
};
