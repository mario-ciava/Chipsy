const fs = require("fs/promises");
const logger = require("../utils/logger");
const {
    CONFIG,
    DEBUG_PNG_PATH,
    DEBUG_SVG_PATH,
    ENABLE_RENDER_DEBUG,
    createCanvas,
    renderCanvasToPng,
    downscaleCanvasToPng,
    ensureCardBackLoaded,
    preloadCards,
    drawBackground,
    drawDivider,
    drawText,
    drawRoundedRect,
    drawCardBack,
    drawCardImage,
    measureTextWidth,
    getCachedCardImage,
    clearImageCache
} = require("./core/cardRenderBase");
const { drawBadge } = require("./shared/drawBadge");
const { drawInfoLine } = require("./shared/drawInfoLine");

const layoutConfig = CONFIG.layout || {};

const derivePlayerRowHeight = () => {
    const titleBlock = CONFIG.sectionTitleSize + (layoutConfig.sectionTitleSpacing || 0);
    const cardsBlock = CONFIG.cardHeight + (layoutConfig.cardsSpacing || 0);
    const valueBlock = CONFIG.valueSize + (layoutConfig.valueSpacing || 0);
    const infoBlock = CONFIG.infoSize + (layoutConfig.sectionBottomPadding || 0);
    const configured = layoutConfig.rowHeightIncrement || 0;
    return Math.max(150, configured, titleBlock + cardsBlock + valueBlock + infoBlock);
};

const PLAYER_ROW_HEIGHT = derivePlayerRowHeight();
const PLAYER_ROW_GAP = Math.max(0, layoutConfig.playerRowGap || 0);
const BASE_PLAYER_ROWS = Math.max(1, layoutConfig.basePlayerRows || 1);

async function drawHand(ctx, hand, options) {
    const {
        title,
        centerX,
        topY,
        maskSecondCard = false,
        showResultBadge = true,
        hasMultipleHands = false,
        isActing = false,
        insured = false,
        subtitle = null,
        slotWidth = CONFIG.canvasWidth
    } = options;

    let cursorY = topY;

    const reachedTwentyOne = Number(hand?.value) === 21 || hand?.blackjack === true;
    const baseTitle = title;

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

    const hasBadges = badges.length > 0;
    const showActingTag = Boolean(baseTitle) && isActing && !reachedTwentyOne && !hasBadges;
    const finalTitle = showActingTag ? `${baseTitle} (acting)` : baseTitle;

    const hasTitle = Boolean(finalTitle);
    let labelWidth = 0;
    const titleFont = `700 ${CONFIG.sectionTitleSize}px "${CONFIG.fontFamily}"`;
    const titleMaxWidth = slotWidth - 40;
    let normalizedTitle = finalTitle;
    if (hasTitle) {
        labelWidth = measureTextWidth(ctx, normalizedTitle, titleFont);
        if (labelWidth > titleMaxWidth) {
            const cutRatio = titleMaxWidth / labelWidth;
            const approxLength = Math.max(6, Math.floor(normalizedTitle.length * cutRatio) - 3);
            normalizedTitle = `${normalizedTitle.slice(0, approxLength)}...`;
            labelWidth = measureTextWidth(ctx, normalizedTitle, titleFont);
        }
    }

    const badgeFont = `700 ${badgeFontSize}px "${CONFIG.fontFamily}"`;
    const badgeWidths = badges.map(badge => measureTextWidth(ctx, badge.text, badgeFont) + badgePaddingX * 2);
    const totalBadgeWidth = badges.length > 0 ? badgeWidths.reduce((acc, width, index) => acc + width + (index > 0 ? badgeGap : 0), 0) : 0;
    const titleBlockWidth = hasTitle ? labelWidth + (badges.length > 0 ? labelBadgeGap + totalBadgeWidth : 0) : 0;
    const startX = hasTitle ? centerX - titleBlockWidth / 2 : 0;

    if (hasTitle) {
        drawText(ctx, normalizedTitle, {
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

        for (let i = 0; i < cardCount; i++) {
            const cardName = cards[i];
            const x = cardsStartX + i * cardSpacing;
            const y = cardsY;

            if (maskSecondCard && i === 1) {
                drawCardBack(ctx, x, y);
                continue;
            }

            const image = cardName ? getCachedCardImage(cardName) : null;
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

    let displayedValue = Number.isFinite(hand.value) ? hand.value : null;
    if (maskSecondCard && cards.length > 0) {
        const visibleCards = cards.filter((_, index) => index !== 1);
        if (visibleCards.length > 0) {
            displayedValue = calculateHandValue(visibleCards).value;
        } else {
            displayedValue = null;
        }
    }

    const valueText = Number.isFinite(displayedValue) ? `Value: ${displayedValue}` : "Value: ??";

    let valueColor = CONFIG.textSecondary;
    let dealerBadge = null;
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

    const infoSegments = [];
    const addInfoSegment = (text, color = CONFIG.textSecondary) => {
        if (!text) return;
        infoSegments.push({ text, color });
    };

    if (hand.bet !== undefined && hand.bet !== null) {
        addInfoSegment(`Bet $${Number(hand.bet).toLocaleString()}`);
    }
    if (Number.isFinite(hand.payout) && hand.payout > 0) {
        addInfoSegment(`Payout +$${Math.abs(hand.payout).toLocaleString()}`, CONFIG.winColor);
    }
    if (Number.isFinite(hand.gold) && hand.gold > 0) {
        addInfoSegment(`Gold +${Math.abs(hand.gold).toLocaleString()}`, CONFIG.pushColor);
    }
    if (Number.isFinite(hand.xp) && hand.xp !== 0) {
        const sign = hand.xp >= 0 ? "+" : "-";
        addInfoSegment(`XP ${sign}${Math.abs(hand.xp).toLocaleString()}`);
    }
    if (insured) {
        addInfoSegment("Insured");
    }

    if (infoSegments.length > 0) {
        const infoY = cursorY;
        drawInfoLine(ctx, infoSegments, {
            centerX,
            y: infoY,
            fontSize: CONFIG.infoSize,
            defaultColor: CONFIG.textSecondary
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

    const dealerHandInfo = calculateHandValue(dealer.cards);
    const normalizedDealer = {
        cards: Array.isArray(dealer.cards) ? dealer.cards : [],
        value: dealerHandInfo.value,
        blackjack: dealerHandInfo.blackjack,
        busted: dealerHandInfo.busted,
        result: null
    };

    const playerHands = [];
    const roundNumber = options.round ?? gameState.round ?? null;
    players.forEach((player, playerIndex) => {
        const hands = Array.isArray(player?.hands) ? player.hands : [];
        const label = resolvePlayerLabel(player, playerIndex);
        hands.forEach((hand, handIndex) => {
            if (!hand) return;

            const { value, busted, blackjack } = calculateHandValue(hand.cards);
            const insuredFlag = Boolean(hand.insured ?? hand.insurance ?? hand.hasInsurance ?? hand.isInsured);
            const isActing = Boolean(hand?.isActing ?? hand?.isCurrent);
            
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
                isActing,
                handsForPlayer: hands.length
            });
        });
    });

    const playerResults = playerHands
        .map(hand => (hand.result || "").toLowerCase())
        .filter(Boolean);
    if (playerResults.length > 0) {
        if (playerResults.some(res => res === "win")) {
            normalizedDealer.result = "lose";
        } else if (playerResults.some(res => res === "push")) {
            normalizedDealer.result = "push";
        } else {
            normalizedDealer.result = "win";
        }
    } else if (normalizedDealer.blackjack) {
        normalizedDealer.result = "win";
    } else if (normalizedDealer.busted) {
        normalizedDealer.result = "lose";
    }

    return {
        dealerCards: normalizedDealer.cards,
        dealerValue: normalizedDealer.value,
        dealerBlackjack: normalizedDealer.blackjack,
        dealerBusted: normalizedDealer.busted,
        playerHands,
        result: options.result ?? null,
        metadata: {
            maskDealerHoleCard: Boolean(options.maskDealerHoleCard),
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

    const rawPlayers = normalized.playerHands.length > 0
        ? normalized.playerHands
        : [{
            cards: [],
            value: null,
            label: "Player",
            result: normalized.result
        }];
    const totalPlayers = rawPlayers.length;

    const participantKeys = rawPlayers.map((hand, index) => {
        if (hand.playerId) return `id:${hand.playerId}`;
        if (hand.ownerId) return `owner:${hand.ownerId}`;
        if (hand.userId) return `user:${hand.userId}`;
        if (hand.originalPlayerId) return `orig:${hand.originalPlayerId}`;
        if (typeof hand.label === "string") {
            return `label:${hand.label.replace(/\s*\(Hand\s+\d+\)\s*$/i, "").trim()}`;
        }
        return `entry:${index}`;
    });
    const uniqueParticipantCount = Math.max(1, new Set(participantKeys).size);
    const maxSlotsPerRow = Math.max(1, CONFIG.layout.maxParticipantsPerRow || 2);
    const totalRowsParticipants = Math.ceil(uniqueParticipantCount / maxSlotsPerRow);
    const totalRowsHands = Math.ceil(totalPlayers / maxSlotsPerRow);
    const totalRows = Math.max(1, totalRowsParticipants, totalRowsHands);
    const additionalRows = Math.max(0, totalRows - BASE_PLAYER_ROWS);
    const additionalHeight = additionalRows > 0
        ? (additionalRows * PLAYER_ROW_HEIGHT) + (additionalRows * PLAYER_ROW_GAP)
        : 0;
    const canvasWidth = CONFIG.canvasWidth;
    const canvasHeight = CONFIG.canvasHeight + additionalHeight;

    const canvas = createCanvas(
        wantsSVG ? canvasWidth : Math.round(canvasWidth * scale),
        wantsSVG ? canvasHeight : Math.round(canvasHeight * scale),
        wantsSVG ? "svg" : undefined
    );
    const ctx = canvas.getContext("2d");
    if (!wantsSVG && scale !== 1) {
        ctx.scale(scale, scale);
    }

    await ensureCardBackLoaded();

    const cardsToPreload = new Set();
    normalized.dealerCards?.forEach(card => { if (card) cardsToPreload.add(card); });
    normalized.playerHands.forEach(hand => {
        (hand.cards || []).forEach(card => { if (card) cardsToPreload.add(card); });
    });
    if (cardsToPreload.size > 0) {
        await preloadCards(Array.from(cardsToPreload));
    }

    drawBackground(ctx, canvasHeight);

    let cursorY = CONFIG.layout.topMargin;
    const globalRoundNumber = Number.isFinite(normalized.metadata?.round)
        ? Math.max(1, Math.trunc(normalized.metadata.round))
        : Number.isFinite(params?.round)
            ? Math.max(1, Math.trunc(params.round))
            : Number.isFinite(params?.metadata?.round)
                ? Math.max(1, Math.trunc(params.metadata.round))
                : null;
    if (globalRoundNumber) {
        const bandPadding = 18;
        const bandHeight = CONFIG.titleSize + bandPadding;
        const bandY = cursorY - bandPadding / 2;
        ctx.save();
        ctx.fillStyle = "rgba(48,48,48,0.95)";
        ctx.fillRect(0, bandY, CONFIG.canvasWidth, bandHeight);
        ctx.restore();

        drawText(ctx, `Round #${globalRoundNumber}` , {
            x: CONFIG.canvasWidth / 2,
            y: cursorY,
            size: CONFIG.titleSize,
            color: CONFIG.textSecondary,
            align: "center",
            baseline: "top",
            bold: true
        });
        cursorY += CONFIG.titleSize + CONFIG.layout.titleSpacing + 12;
    }

    const dealerResult = (() => {
        if (normalized.maskDealerHoleCard) return null
        const playerResults = normalized.playerHands.map(hand => (hand.result || "").toLowerCase()).filter(Boolean)
        if (playerResults.length === 0) {
            return normalized.dealerBlackjack ? "win" : normalized.dealerBusted ? "lose" : null
        }
        if (playerResults.some(res => res === "win")) return "lose"
        if (playerResults.some(res => res === "push")) return "push"
        if (playerResults.every(res => res === "lose")) return "win"
        return null
    })()

    const displayDealerBlackjack = normalized.maskDealerHoleCard ? false : Boolean(normalized.dealerBlackjack)
    const displayDealerBusted = normalized.maskDealerHoleCard ? false : Boolean(normalized.dealerBusted)
    const displayDealerResult = displayDealerBusted
        ? "lose"
        : displayDealerBlackjack
            ? "win"
            : dealerResult

    cursorY = await drawHand(ctx, {
        cards: normalized.dealerCards,
        value: normalized.dealerValue,
        result: displayDealerResult,
        blackjack: displayDealerBlackjack,
        busted: displayDealerBusted
    }, {
        title: "Dealer",
        centerX: CONFIG.canvasWidth / 2,
        topY: cursorY,
        maskSecondCard: normalized.maskDealerHoleCard,
        showResultBadge: !normalized.maskDealerHoleCard && Boolean(dealerResult),
        isDealer: true
    });

    const dividerY = cursorY + CONFIG.layout.dealerSectionSpacing;
    drawDivider(ctx, dividerY);
    cursorY = dividerY + CONFIG.layout.dividerOffset;

    const players = rawPlayers;

    const playerRowTop = cursorY + CONFIG.layout.playersTopSpacing;
    // totalPlayers already defined above
    let playerIndex = 0;
    let rowsRemaining = totalRows;
    let rowTop = playerRowTop;

    while (playerIndex < totalPlayers && rowsRemaining > 0) {
        const playersRemaining = totalPlayers - playerIndex;
        const idealSlots = Math.max(1, Math.ceil(playersRemaining / rowsRemaining));
        const slotsThisRow = Math.min(maxSlotsPerRow, idealSlots);
        const slotWidth = CONFIG.canvasWidth / slotsThisRow;

        let rowBottom = rowTop;
        for (let slotIndex = 0; slotIndex < slotsThisRow && playerIndex < totalPlayers; slotIndex++) {
            const hand = players[playerIndex];
            const centerX = slotWidth * (slotIndex + 0.5);

            const headerTitle = hand.label
                ?? (totalPlayers > 1 ? `Player ${playerIndex + 1}` : "Player");
            const subtitle = null;

            const isActing = Boolean(hand?.isActing);
            const insured = Boolean(hand.insured ?? hand.insurance ?? hand.hasInsurance ?? hand.isInsured);
            const hasMultipleHands = (hand.handsForPlayer ?? totalPlayers) > 1;

            const handBottom = await drawHand(ctx, hand, {
                title: headerTitle,
                centerX,
                topY: rowTop,
                showResultBadge: true,
                hasMultipleHands,
                isActing,
                insured,
                subtitle,
                slotWidth
            });

            rowBottom = Math.max(rowBottom, handBottom);
            playerIndex += 1;
        }

        rowsRemaining -= 1;
        rowTop = playerIndex < totalPlayers
            ? rowBottom + (CONFIG.layout.playerRowGap || 50)
            : rowBottom;
    }

    cursorY = rowTop;

    const baseBuffer = canvas.toBuffer(wantsSVG ? "image/svg+xml" : "image/png");

    if (wantsSVG && ENABLE_RENDER_DEBUG) {
        try {
            await fs.writeFile(DEBUG_SVG_PATH, baseBuffer);
        } catch (error) {
            logger.debug("Failed to store render debug SVG", {
                scope: "cardTableRenderer",
                path: DEBUG_SVG_PATH,
                error: error.message
            });
        }
        return baseBuffer;
    }

    if (wantsSVG) {
        return baseBuffer;
    }

    if (ENABLE_RENDER_DEBUG) {
        try {
            await fs.writeFile(DEBUG_PNG_PATH, baseBuffer);
        } catch (error) {
            logger.debug("Failed to store render debug PNG", {
                scope: "cardTableRenderer",
                path: DEBUG_PNG_PATH,
                error: error.message
            });
        }
    }

    if (Number.isFinite(CONFIG.embedTargetWidth) && CONFIG.embedTargetWidth > 0) {
        try {
            const targetWidth = CONFIG.embedTargetWidth;
            const sourceWidth = canvas.width;
            const aspectRatio = canvas.height / canvas.width;
            const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio));

            if (targetWidth < sourceWidth) {
                return downscaleCanvasToPng(canvas, targetWidth, targetHeight, CONFIG.embedCompressionLevel);
            }
        } catch (error) {
            logger.debug("Failed to downscale render for embed", {
                scope: "cardTableRenderer",
                targetWidth: CONFIG.embedTargetWidth,
                error: error.message
            });
        }
    }

    return baseBuffer;
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
