const path = require("path");
const fs = require("fs/promises");
const { createCanvas, loadImage, registerFont } = require("canvas");

let sharp;
try {
    sharp = require("sharp");
} catch (error) {
    sharp = null;
    logger.debug("sharp not available - falling back to raw canvas output", {
        scope: "cardTableRenderer",
        error: error.message
    });
}
const logger = require("../utils/logger");
const { gameToImage, isValidGameCard } = require("../utils/cardConverter");

const PROJECT_ROOT = path.join(__dirname, "../..");

// ============================================================================
// CONFIGURATION (tune these values to calibrate the render)
// ============================================================================
const DEBUG_PNG_PATH = path.join(PROJECT_ROOT, "render-debug.png");
const DEBUG_SVG_PATH = path.join(PROJECT_ROOT, "render-debug.svg");

let cardBackPromise = null;

const CONFIG = Object.freeze({
    canvasWidth: 1280,
    canvasHeight: 960,

    backgroundTop: "#0B3B24",
    backgroundBottom: "#092A1A",
    dividerColor: "#C9A24A",

    cardWidth: 138,
    cardHeight: 198,
    cardSpacing: 20,
    cardsPath: path.join(PROJECT_ROOT, "assets/cards"),
    cardBackImage: path.join(PROJECT_ROOT, "assets/cards/back.png"),

    fontFamily: "sans-serif",
    fontPaths: [],

    titleSize: 48,
    sectionTitleSize: 40,
    subtitleSize: 24,
    valueSize: 32,
    infoSize: 26,

    textPrimary: "#FFFFFF",
    textSecondary: "#E0E0E0",
    winColor: "#57C26B",
    loseColor: "#EB5757",
    pushColor: "#F2C94C",

    shadow: {
        offsetX: 4,
        offsetY: 6,
        blur: 18,
        color: "rgba(0,0,0,0.35)"
    },

    outputScale: 1.5,

    embedTargetWidth: 768,
    embedCompressionLevel: 9,

    layout: {
        topMargin: 60,
        titleSpacing: 26,
        dealerSectionSpacing: 24,
        dividerOffset: 28,
        playersTopSpacing: 40,
        sectionTitleSpacing: 18,
        subtitleSpacing: 6,
        cardsSpacing: 22,
        valueSpacing: 18,
        infoSpacing: 12,
        sectionBottomPadding: 28
    }
});

// Register custom fonts if they exist on disk.


// ============================================================================
// CARD ASSET CACHE
// ============================================================================
const cardCache = new Map();

function normalizeCardName(card) {
    if (!card || typeof card !== "string") {
        throw new Error(`Invalid card name ${card}`);
    }
    if (card.length === 2 && isValidGameCard(card)) {
        return gameToImage(card);
    }
    return card;
}

async function ensureCardBackLoaded() {
    if (cardCache.has("__card_back__")) return;
    if (!cardBackPromise) {
        cardBackPromise = loadImage(CONFIG.cardBackImage)
            .then(image => {
                cardCache.set("__card_back__", image);
                return image;
            })
            .catch(error => {
                logger.error("Failed to load card back image", {
                    scope: "cardTableRenderer",
                    path: CONFIG.cardBackImage,
                    error: error.message
                });
                return null;
            });
    }
    await cardBackPromise;
}

async function loadCardImage(cardName) {
    const normalized = normalizeCardName(cardName);
    if (cardCache.has(normalized)) {
        return cardCache.get(normalized);
    }

    const cardPath = path.join(CONFIG.cardsPath, `${normalized}.png`);
    try {
        const image = await loadImage(cardPath);
        cardCache.set(normalized, image);
        return image;
    } catch (error) {
        logger.error("Unable to load card asset", {
            scope: "cardTableRenderer",
            cardName: normalized,
            cardPath,
            error: error.message
        });
        return null;
    }
}

async function preloadCards(cardNames = []) {
    await ensureCardBackLoaded();
    await Promise.all((cardNames || []).map(card => loadCardImage(card).catch(() => null)));
}

function clearImageCache() {
    cardCache.clear();
}

function createSeededRandom(seed = 0xdecafbad) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

let backgroundNoiseCanvas = null;

function getBackgroundNoiseCanvas(size = 64) {
    if (backgroundNoiseCanvas) {
        return backgroundNoiseCanvas;
    }
    const noiseCanvas = createCanvas(size, size);
    const nctx = noiseCanvas.getContext("2d");
    const imageData = nctx.createImageData(size, size);
    const data = imageData.data;
    const random = createSeededRandom();
    for (let i = 0; i < data.length; i += 4) {
        const shade = 22 + random() * 32;
        data[i] = shade;
        data[i + 1] = shade * 0.95;
        data[i + 2] = shade * 0.9;
        data[i + 3] = 255;
    }
    nctx.putImageData(imageData, 0, 0);
    backgroundNoiseCanvas = noiseCanvas;
    return noiseCanvas;
}

// ============================================================================
// DRAW HELPERS
// ============================================================================
function drawBackground(ctx) {
    const { canvasWidth: width, canvasHeight: height } = CONFIG;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, CONFIG.backgroundTop);
    gradient.addColorStop(1, CONFIG.backgroundBottom);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle light band at center
    const bandHeight = height * 0.18;
    const bandY = height * 0.22;
    const bandGradient = ctx.createLinearGradient(0, bandY, 0, bandY + bandHeight);
    bandGradient.addColorStop(0, "rgba(255,255,255,0)");
    bandGradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
    bandGradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = bandGradient;
    ctx.fillRect(0, bandY, width, bandHeight);
    ctx.restore();

    const bottomGlow = ctx.createLinearGradient(0, height * 0.65, 0, height);
    bottomGlow.addColorStop(0, "rgba(0,0,0,0)");
    bottomGlow.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.save();
    ctx.fillStyle = bottomGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const edgeGlow = ctx.createRadialGradient(width / 2, height * 0.55, width * 0.1, width / 2, height * 0.55, width * 0.7);
    edgeGlow.addColorStop(0, "rgba(255,255,255,0.2)");
    edgeGlow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    const noiseCanvas = getBackgroundNoiseCanvas();
    const pattern = ctx.createPattern(noiseCanvas, "repeat");
    if (pattern) {
        ctx.save();
        ctx.globalAlpha = 0.045;
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
    }

    const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.35, width / 2, height / 2, width * 0.78);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

function drawDivider(ctx, y) {
    ctx.strokeStyle = CONFIG.dividerColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(CONFIG.canvasWidth * 0.12, y);
    ctx.lineTo(CONFIG.canvasWidth * 0.88, y);
    ctx.stroke();
}

function drawText(ctx, text, {
    x,
    y,
    size,
    color,
    align = "center",
    baseline = "middle",
    bold = false,
    shadow = false
}) {
    if (!text) return;
    const font = `${bold ? "700" : "400"} ${size}px "${CONFIG.fontFamily}"`;
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;

    if (shadow) {
        ctx.save();
        ctx.shadowColor = CONFIG.shadow.color;
        ctx.shadowBlur = CONFIG.shadow.blur * 0.6;
        ctx.shadowOffsetX = CONFIG.shadow.offsetX * 0.4;
        ctx.shadowOffsetY = CONFIG.shadow.offsetY * 0.4;
        ctx.fillStyle = color;
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawCardBack(ctx, x, y) {
    const back = cardCache.get("__card_back__");
    if (back) {
        ctx.drawImage(back, x, y, CONFIG.cardWidth, CONFIG.cardHeight);
    } else {
        drawRoundedRect(ctx, x, y, CONFIG.cardWidth, CONFIG.cardHeight, 12);
        ctx.fillStyle = "#1F5F3C";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.lineWidth = 4;
        drawRoundedRect(ctx, x + 12, y + 12, CONFIG.cardWidth - 24, CONFIG.cardHeight - 24, 10);
        ctx.stroke();
    }
}

function drawCardImage(ctx, image, x, y) {
    ctx.drawImage(image, x, y, CONFIG.cardWidth, CONFIG.cardHeight);
}

function measureTextWidth(ctx, text, font) {
    ctx.save();
    ctx.font = font;
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
}

function drawBadge(ctx, text, { x, y, fill, textColor, fontSize, paddingX = 14, paddingY = 6, bold = true }) {
    const font = `${bold ? "700" : "500"} ${fontSize}px "${CONFIG.fontFamily}"`;
    ctx.save();
    ctx.font = font;
    const textWidth = ctx.measureText(text).width;
    const width = textWidth + paddingX * 2;
    const height = fontSize + paddingY * 2;
    const radius = height / 2;

    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.9;
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.restore();

    drawText(ctx, text, {
        x: x + width / 2,
        y: y + height / 2,
        size: fontSize,
        color: textColor,
        align: "center",
        baseline: "middle",
        bold
    });

    return { width, height };
}

async function drawHand(ctx, hand, options) {
    const {
        title,
        centerX,
        topY,
        maskSecondCard = false,
        showResultBadge = true,
        hasMultipleHands = false,
        isCurrent = false,
        insured = false,
        subtitle = null,
        slotWidth = CONFIG.canvasWidth
    } = options;

    let cursorY = topY;

    const finalTitle = isCurrent ? `${title} (waiting..)` : title;

    const titleFont = `700 ${CONFIG.sectionTitleSize}px "${CONFIG.fontFamily}"`;
    const hasTitle = Boolean(finalTitle);
    const labelWidth = hasTitle ? measureTextWidth(ctx, finalTitle, titleFont) : 0;

    const badges = [];
    const badgeFontSize = Math.max(24, CONFIG.infoSize + 2);
    const badgePaddingX = 14;
    const badgePaddingY = 6;
    const badgeGap = 12;
    const labelBadgeGap = 18;

    const result = typeof hand.result === "string" ? hand.result.toLowerCase() : null;
    const seenBadges = new Set();
    const pushBadge = (text, fill, textColor) => {
        if (seenBadges.has(text)) return;
        badges.push({ text, fill, textColor });
        seenBadges.add(text);
    };

    if (showResultBadge) {
        if (hand.busted) {
            pushBadge("LOSE", CONFIG.loseColor, "#FFFFFF");
        }
        if (result === "win") pushBadge("WIN", CONFIG.winColor, "#0B2B18");
        if (result === "lose") pushBadge("LOSE", CONFIG.loseColor, "#FFFFFF");
        if (result === "push") pushBadge("PUSH", CONFIG.pushColor, "#2C2200");
        if (hand.blackjack) pushBadge("BLACKJACK", CONFIG.winColor, "#0B2B18");
    }

    const badgeFont = `700 ${badgeFontSize}px "${CONFIG.fontFamily}"`;
    const badgeWidths = badges.map(badge => measureTextWidth(ctx, badge.text, badgeFont) + badgePaddingX * 2);
    const totalBadgeWidth = badges.length > 0 ? badgeWidths.reduce((acc, width, index) => acc + width + (index > 0 ? badgeGap : 0), 0) : 0;
    const titleBlockWidth = hasTitle ? labelWidth + (badges.length > 0 ? labelBadgeGap + totalBadgeWidth : 0) : 0;
    const startX = hasTitle ? centerX - titleBlockWidth / 2 : 0;

    if (hasTitle) {
        drawText(ctx, finalTitle, {
            x: startX,
            y: cursorY,
            size: CONFIG.sectionTitleSize,
            color: CONFIG.textPrimary,
            align: "left",
            baseline: "top",
            bold: true
        });

        if (badges.length > 0) {
            let badgeX = startX + labelWidth + labelBadgeGap;
            const badgeHeight = badgeFontSize + badgePaddingY * 2;
            const badgeTop = cursorY + Math.max(0, (CONFIG.sectionTitleSize - badgeHeight) / 2);
            badges.forEach((badge, index) => {
                const metrics = drawBadge(ctx, badge.text, {
                    x: badgeX,
                    y: badgeTop,
                    fill: badge.fill,
                    textColor: badge.textColor,
                    fontSize: badgeFontSize,
                    paddingX: badgePaddingX,
                    paddingY: badgePaddingY,
                    bold: true
                });
                badgeX += metrics.width + (index < badges.length - 1 ? badgeGap : 0);
            });
        }

        cursorY += CONFIG.sectionTitleSize;
    }

    if (subtitle) {
        cursorY += CONFIG.layout.subtitleSpacing;
        drawText(ctx, subtitle, {
            x: centerX,
            y: cursorY,
            size: CONFIG.subtitleSize,
            color: CONFIG.textPrimary,
            align: "center",
            baseline: "top",
            bold: true
        });
        cursorY += CONFIG.subtitleSize + CONFIG.layout.sectionTitleSpacing;
    } else if (!hasTitle) {
        cursorY += CONFIG.layout.sectionTitleSpacing;
    } else {
        cursorY += CONFIG.layout.sectionTitleSpacing;
    }

    const cards = Array.isArray(hand.cards) ? hand.cards : [];
    const cardCount = cards.length;
    const cardsY = cursorY;

    if (cardCount === 0) {
        const x = centerX - CONFIG.cardWidth / 2;
        drawCardBack(ctx, x, cardsY);
    } else {
        const maxCardsWidth = slotWidth - 40;
        let cardSpacing = CONFIG.cardWidth + CONFIG.cardSpacing;

        const totalWidth = (cardCount - 1) * cardSpacing + CONFIG.cardWidth;

        if (totalWidth > maxCardsWidth) {
            cardSpacing = (maxCardsWidth - CONFIG.cardWidth) / (cardCount - 1);
        }

        const finalWidth = (cardCount - 1) * cardSpacing + CONFIG.cardWidth;
        const cardsStartX = centerX - finalWidth / 2;

        await Promise.all(cards.map(card => loadCardImage(card)));

        for (let i = 0; i < cardCount; i++) {
            const cardName = cards[i];
            const x = cardsStartX + i * cardSpacing;
            const y = cardsY;

            if (maskSecondCard && i === 1) {
                drawCardBack(ctx, x, y);
                continue;
            }

            const image = cardName ? cardCache.get(normalizeCardName(cardName)) : null;
            if (image) {
                drawCardImage(ctx, image, x, y);
            } else {
                drawCardBack(ctx, x, y);
            }
        }
    }

    cursorY = cardsY + CONFIG.cardHeight + CONFIG.layout.cardsSpacing;
    const valueY = cursorY;
    cursorY += CONFIG.valueSize + CONFIG.layout.valueSpacing;

    const valueText = maskSecondCard
        ? "Value: ??"
        : (Number.isFinite(hand.value) ? `Value: ${hand.value}` : "Value: ??");

    let valueColor = CONFIG.textSecondary;
    if (result === "win") valueColor = CONFIG.winColor;
    if (result === "lose") valueColor = CONFIG.loseColor;
    if (result === "push") valueColor = CONFIG.pushColor;
    if (hand.blackjack) valueColor = CONFIG.winColor;
    if (hand.busted) valueColor = CONFIG.loseColor;

    drawText(ctx, valueText, {
        x: centerX,
        y: valueY,
        size: CONFIG.valueSize,
        color: valueColor,
        align: "center",
        baseline: "top",
        bold: true
    });

    const infoParts = [];
    if (hand.bet !== undefined && hand.bet !== null) {
        infoParts.push(`Bet $${Number(hand.bet).toLocaleString()}`);
    }
    if (Number.isFinite(hand.payout) && hand.payout > 0) {
        infoParts.push(`Payout +$${Math.abs(hand.payout).toLocaleString()}`);
    }
    if (Number.isFinite(hand.xp) && hand.xp !== 0) {
        const sign = hand.xp >= 0 ? "+" : "-";
        infoParts.push(`XP ${sign}${Math.abs(hand.xp).toLocaleString()}`);
    }
    if (insured) {
        infoParts.push("Insured");
    }

    if (infoParts.length > 0) {
        const infoY = cursorY;
        drawText(ctx, infoParts.join(" • "), {
            x: centerX,
            y: infoY,
            size: CONFIG.infoSize,
            color: CONFIG.textSecondary,
            align: "center",
            baseline: "top",
            bold: false
        });
        cursorY += CONFIG.infoSize + CONFIG.layout.sectionBottomPadding;
    } else {
        cursorY += CONFIG.layout.sectionBottomPadding;
    }

    return cursorY;
}

// ============================================================================
// NORMALIZATION
// ============================================================================
function calculateHandValue(cards = []) {
    if (!Array.isArray(cards) || cards.length === 0) {
        return { value: 0, busted: false, blackjack: false };
    }

    let aces = 0;
    let value = 0;

    for (const card of cards) {
        const cardValue = card[0];
        if (cardValue === 'A') {
            aces++;
            value += 11;
        } else if (['K', 'Q', 'J', 'T'].includes(cardValue)) {
            value += 10;
        } else {
            value += parseInt(cardValue, 10);
        }
    }

    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }

    const busted = value > 21;
    const blackjack = cards.length === 2 && value === 21;

    return { value, busted, blackjack };
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

function createBlackjackTableState(gameState = {}, options = {}) {
    const dealer = gameState.dealer ?? {};
    const players = Array.isArray(gameState.players) ? gameState.players : [];

    const focusPlayerId = options.focusPlayerId;

    const dealerHandInfo = calculateHandValue(dealer.cards);
    const normalizedDealer = {
        cards: Array.isArray(dealer.cards) ? dealer.cards : [],
        value: dealerHandInfo.value,
        blackjack: dealerHandInfo.blackjack,
        busted: dealerHandInfo.busted
    };

    const playerHands = [];
    const roundNumber = options.round ?? gameState.round ?? null;
    const roundLabel = Number.isFinite(roundNumber) ? `Round #${Math.max(1, Math.trunc(roundNumber))}` : null;
    players.forEach((player, playerIndex) => {
        const hands = Array.isArray(player?.hands) ? player.hands : [];
        const label = resolvePlayerLabel(player, playerIndex);
        hands.forEach((hand, handIndex) => {
            if (!hand) return;

            const { value, busted, blackjack } = calculateHandValue(hand.cards);
            const insuredFlag = Boolean(hand.insured ?? hand.insurance ?? hand.hasInsurance ?? hand.isInsured);
            const isCurrent = hand.isCurrent;
            const handRoundValue = hand.round ?? hand.roundNumber ?? null;
            const specificRoundLabel = hand.roundLabel ?? hand.roundTitle ?? (Number.isFinite(handRoundValue) ? `Round #${Math.max(1, Math.trunc(handRoundValue))}` : null);
            
            playerHands.push({
                cards: Array.isArray(hand.cards) ? hand.cards : [],
                value: value,
                bet: hand.bet ?? hand.wager ?? hand.stake ?? null,
                payout: hand.payout ?? hand.net ?? null,
                xp: hand.xp ?? hand.xpEarned ?? null,
                result: hand.result ?? hand.outcome ?? null,
                blackjack: blackjack,
                busted: busted,
                label: hands.length > 1 ? `${label} (Hand ${handIndex + 1})` : label,
                playerId: player?.id,
                insured: insuredFlag,
                isCurrent,
                handsForPlayer: hands.length
            });
        });
    });

    const defaultName = playerHands[0]?.label ?? resolvePlayerLabel(players[0], 0);

    return {
        playerName: options.playerName ?? defaultName ?? "Player",
        dealerCards: normalizedDealer.cards,
        dealerValue: normalizedDealer.value,
        dealerBlackjack: normalizedDealer.blackjack,
        dealerBusted: normalizedDealer.busted,
        playerHands,
        result: options.result ?? null,
        title: options.title ?? null,
        appearance: options.appearance ?? {},
        metadata: {
            maskDealerHoleCard: Boolean(options.maskDealerHoleCard),
            focusPlayerId,
            round: roundNumber
        }
    };
}

function normalizeRenderInput(params = {}) {
    const state = {
        dealerCards: Array.isArray(params.dealerCards) ? params.dealerCards : [],
        dealerValue: params.dealerValue ?? null,
        dealerBusted: Boolean(params.dealerBusted),
        dealerBlackjack: Boolean(params.dealerBlackjack),
        maskDealerHoleCard: Boolean(params.metadata?.maskDealerHoleCard ?? params.maskDealerHoleCard),
        playerHands: Array.isArray(params.playerHands) ? params.playerHands : [],
        title: params.title ?? null,
        result: params.result ?? null,
        metadata: params.metadata ?? {}
    };

    return state;
}

// ============================================================================
// RENDERING
// ============================================================================
async function renderCardTable(params) {
    const requestedFormat = typeof params?.outputFormat === "string"
        ? params.outputFormat.toLowerCase()
        : "png";
    const normalized = params?.sanitizedParams
        ? params.sanitizedParams
        : normalizeRenderInput(params);

    const wantsSVG = requestedFormat === "svg";
    const scale = wantsSVG ? 1 : (Number.isFinite(CONFIG.outputScale) && CONFIG.outputScale > 0 ? CONFIG.outputScale : 1);
    const canvas = createCanvas(
        wantsSVG ? CONFIG.canvasWidth : Math.round(CONFIG.canvasWidth * scale),
        wantsSVG ? CONFIG.canvasHeight : Math.round(CONFIG.canvasHeight * scale),
        wantsSVG ? "svg" : undefined
    );
    const ctx = canvas.getContext("2d");
    if (!wantsSVG && scale !== 1) {
        ctx.scale(scale, scale);
    }

    await ensureCardBackLoaded();
    drawBackground(ctx);

    let cursorY = CONFIG.layout.topMargin;
    const globalRoundNumber = Number.isFinite(normalized.metadata?.round)
        ? Math.max(1, Math.trunc(normalized.metadata.round))
        : Number.isFinite(params?.round)
            ? Math.max(1, Math.trunc(params.round))
            : Number.isFinite(params?.metadata?.round)
                ? Math.max(1, Math.trunc(params.metadata.round))
                : null;
    if (globalRoundNumber) {
        drawText(ctx, `Round #${globalRoundNumber}` , {
            x: CONFIG.canvasWidth / 2,
            y: cursorY,
            size: CONFIG.titleSize,
            color: CONFIG.textSecondary,
            align: "center",
            baseline: "top",
            bold: true
        });
        cursorY += CONFIG.titleSize + CONFIG.layout.titleSpacing;
    }

    cursorY = await drawHand(ctx, {
        cards: normalized.dealerCards,
        value: normalized.dealerValue,
        result: normalized.dealerBusted ? "lose" : normalized.dealerBlackjack ? "win" : null
    }, {
        title: "Dealer",
        centerX: CONFIG.canvasWidth / 2,
        topY: cursorY,
        maskSecondCard: normalized.maskDealerHoleCard,
        showResultBadge: false
    });

    const dividerY = cursorY + CONFIG.layout.dealerSectionSpacing;
    drawDivider(ctx, dividerY);
    cursorY = dividerY + CONFIG.layout.dividerOffset;

    const players = normalized.playerHands.length > 0
        ? normalized.playerHands
        : [{
            cards: [],
            value: null,
            label: "Player",
            result: normalized.result
        }];

    const playerRowTop = cursorY + CONFIG.layout.playersTopSpacing;
    const slotCount = players.length;
    const slotWidth = CONFIG.canvasWidth / (slotCount || 1);

    for (let i = 0; i < slotCount; i++) {
        const hand = players[i];
        const centerX = slotWidth * (i + 0.5);

        const headerTitle = hand.label
            ?? (slotCount > 1 ? `Player ${i + 1}` : "Player");
        const subtitle = null;

        const isCurrent = hand.isCurrent;
        const insured = Boolean(hand.insured ?? hand.insurance ?? hand.hasInsurance ?? hand.isInsured);
        const hasMultipleHands = (hand.handsForPlayer ?? slotCount) > 1;

        await drawHand(ctx, hand, {
            title: headerTitle,
            centerX,
            topY: playerRowTop,
            showResultBadge: true,
            hasMultipleHands,
            isCurrent,
            insured,
            subtitle,
            slotWidth
        });
    }

    const buffer = canvas.toBuffer(wantsSVG ? "image/svg+xml" : "image/png");

    if (wantsSVG) {
        try {
            await fs.writeFile(DEBUG_SVG_PATH, buffer);
        } catch (error) {
            logger.debug("Failed to store render debug SVG", {
                scope: "cardTableRenderer",
                path: DEBUG_SVG_PATH,
                error: error.message
            });
        }
        return buffer;
    }

    try {
        await fs.writeFile(DEBUG_PNG_PATH, buffer);
    } catch (error) {
        logger.debug("Failed to store render debug PNG", {
            scope: "cardTableRenderer",
            path: DEBUG_PNG_PATH,
            error: error.message
        });
    }

    if (sharp && Number.isFinite(CONFIG.embedTargetWidth) && CONFIG.embedTargetWidth > 0) {
        try {
            const targetWidth = CONFIG.embedTargetWidth;
            const aspectRatio = CONFIG.canvasHeight / CONFIG.canvasWidth;
            const targetHeight = Math.round(targetWidth * aspectRatio);
            const resized = await sharp(buffer)
                .resize({
                    width: targetWidth,
                    height: targetHeight,
                    fit: "inside",
                    withoutEnlargement: true,
                    kernel: sharp.kernel.lanczos3
                })
                .png({
                    compressionLevel: CONFIG.embedCompressionLevel ?? 8,
                    adaptiveFiltering: true,
                    palette: true
                })
                .toBuffer();
            return resized;
        } catch (error) {
            logger.debug("Failed to downscale render for embed", {
                scope: "cardTableRenderer",
                targetWidth: CONFIG.embedTargetWidth,
                error: error.message
            });
        }
    }

    return buffer;
}

async function renderCardTableSVG(params) {
    const context = params?.sanitizedParams
        ? { ...params }
        : params;
    return renderCardTable({ ...context, outputFormat: "svg" });
}

async function renderSceneToSVG() {
    throw new Error("renderSceneToSVG is unavailable in canvas mode.");
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
    renderCardTable,
    renderCardTableSVG,
    renderSceneToSVG,
    createBlackjackTableState,
    preloadCards,
    clearImageCache,
    CONFIG
};