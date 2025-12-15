const logger = require("../../shared/logger")
const setSeparator = require("../../shared/utils/setSeparator")
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
} = require("./core/cardRenderBase")
const { drawBadge } = require("./shared/drawBadge")
const { drawInfoLine } = require("./shared/drawInfoLine")

const BADGE_FONT_SIZE = CONFIG.valueSize
const BADGE_PADDING_X = 14
const BADGE_PADDING_Y = 8
const BADGE_OPACITY = 0.85  // Reduced from 1.0 for better text readability

// Badge color fills (solid colors, fully opaque)
const BADGE_COLORS = {
    pot: "rgba(255, 215, 0, 1.0)",      // Gold
    allIn: "rgba(242, 201, 76, 1.0)",   // Yellow/Gold
    stack: "rgba(255, 255, 255, 0.15)", // Subtle white background
    action: {
        fold: "#D32F2F",                 // Red
        check: "#9CA3AF",                // Gray
        call: "#2F80ED",                 // Blue
        bet: "#2F80ED",                  // Blue
        raise: "#2F80ED",                // Blue
        allin: "#D32F2F"                 // Red
    }
}

const PLAYER_PANEL_SCALE = 0.7

const TEXAS_LAYOUT = {
    maxPlayersPerRow: 2,
    blockGap: 40,
    rowGap: 60,
    slotPadding: 26,
    panelSlotPadding: 13,
    playerBlockHeight: CONFIG.cardHeight + 120,
    panelBlockHeight: CONFIG.cardHeight + 20
}

const PLAYER_PANEL_CONFIG = {
    width: 360,
    height: TEXAS_LAYOUT.panelBlockHeight + 20,
    topPadding: 10,
    targetWidth: 240
}

const sanitizeChips = (value) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    return Math.max(0, Math.floor(numeric))
}

const stageLabels = {
    0: "Pre-Flop",
    3: "Flop",
    4: "Turn",
    5: "River"
}

const resolveStageLabel = (rawStage, boardCardsLength) => {
    if (typeof rawStage === "string" && rawStage.length > 0) {
        return rawStage
    }
    return stageLabels[boardCardsLength] || "Showdown"
}

function normalizeTexasPlayers(players = [], { showdown, focusPlayerId, revealFocusCards, revealPlayerIds }) {
    const revealSet = Array.isArray(revealPlayerIds) ? new Set(revealPlayerIds) : null
    return players.map((player, index) => {
        const label =
            player?.label ||
            player?.tag ||
            player?.username ||
            player?.name ||
            player?.user?.username ||
            `Player ${index + 1}`

        const cards = Array.isArray(player?.cards) ? player.cards.filter(Boolean) : []
        const showCards = Boolean(
            showdown ||
            player?.showCards ||
            (revealFocusCards && focusPlayerId && player?.id === focusPlayerId) ||
            (revealSet && player?.id != null && revealSet.has(player.id))
        )
        const stack = sanitizeChips(player?.stack)
        const bet = sanitizeChips(player?.bet)
        const totalBet = sanitizeChips(player?.totalBet)
        const winnings = sanitizeChips(player?.winnings)
        const gold = sanitizeChips(player?.gold)

        const folded = Boolean(player?.folded ?? player?.status?.folded)
        const allIn = Boolean(player?.allIn ?? player?.status?.allIn)
        const eliminated = Boolean(player?.eliminated ?? player?.status?.removed)
        const leftDuringPlay = Boolean(player?.leftDuringPlay ?? player?.status?.leftThisHand)
        const pendingRebuy = Boolean(player?.pendingRebuy ?? player?.status?.pendingRebuy)
        const isActing = Boolean(player?.isActing ?? player?.isCurrent ?? ((focusPlayerId && player?.id === focusPlayerId) && !showdown))
        const allInAmount = allIn ? sanitizeChips(player?.allInAmount ?? totalBet ?? bet) : null

        const handRank = showdown ? (player?.handRank || player?.hand?.name || null) : null
        const statusLabel =
            player?.statusLabel ||
            (eliminated ? "Left table" : null) ||
            (folded ? "Folded" : null)
        const lastAction = player?.lastAction || player?.status?.lastAction || null

        return {
            id: player?.id ?? `player-${index}`,
            label,
            cards,
            showCards,
            stack,
            bet,
            totalBet,
            winnings,
            gold,
            folded,
            allIn,
            allInAmount,
            eliminated,
            leftDuringPlay: leftDuringPlay || pendingRebuy,
            pendingRebuy,
            isActing,
            statusLabel,
            focus: Boolean(focusPlayerId && player?.id === focusPlayerId),
            handRank,
            lastAction
        }
    })
}

function createTexasTableState(rawState = {}, options = {}) {
    const showdown = Boolean(options.showdown ?? rawState.showdown)
    const focusPlayerId = options.focusPlayerId ?? rawState.focusPlayerId ?? null
    const revealFocusCards = Boolean(options.revealFocusCards ?? rawState.revealFocusCards)
    const revealPlayerIds = options.revealPlayerIds ?? rawState.revealPlayerIds ?? null
    const boardCards = Array.isArray(rawState.boardCards) ? rawState.boardCards.filter(Boolean) : []
    const potTotal = sanitizeChips(rawState.potTotal)
    const sidePots = Array.isArray(rawState.sidePots) ? rawState.sidePots.filter(pot => Number.isFinite(pot?.amount)) : []
    const round = options.round ?? rawState.round ?? rawState.metadata?.round
    const blinds = options.blinds ?? rawState.blinds ?? rawState.metadata?.blinds ?? null
    const stage = resolveStageLabel(options.stage ?? rawState.stage, boardCards.length)

    return {
        boardCards,
        players: normalizeTexasPlayers(rawState.players || [], { showdown, focusPlayerId, revealFocusCards, revealPlayerIds }),
        metadata: {
            title: options.title ?? rawState.title ?? "Texas Hold'em",
            round: Number.isFinite(round) ? Math.max(1, Math.floor(round)) : null,
            stage,
            showdown,
            potTotal,
            sidePots,
            focusPlayerId,
            blinds,
            info: rawState.metadata?.info || options.info || null
        }
    }
}

const collectCardsToPreload = (state) => {
    const cards = new Set()
    state.boardCards.forEach(card => { if (card) cards.add(card) })
    state.players.forEach((player) => {
        if (!player.showCards) return
        player.cards.forEach(card => { if (card) cards.add(card) })
    })
    return Array.from(cards)
}

const collectWinnerIds = (state = {}) => {
    const winners = new Set()
    const sidePots = Array.isArray(state?.metadata?.sidePots)
        ? state.metadata.sidePots
        : Array.isArray(state?.sidePots)
            ? state.sidePots
            : []

    sidePots.forEach((pot) => {
        if (!pot || !Array.isArray(pot.winners)) return
        pot.winners.forEach((winnerId) => {
            if (winnerId == null) return
            winners.add(winnerId)
        })
    })

    if (Array.isArray(state?.players)) {
        state.players.forEach((player) => {
            if (!player || player.id == null) return
            if (Number.isFinite(player.winnings) && player.winnings > 0) {
                winners.add(player.id)
            }
        })
    }

    return winners
}

const resolvePlayerOutcome = (player, { showdown = false, winnerIds } = {}) => {
    if (!showdown || !player || player.folded || player.eliminated) {
        return { isWinner: false, isLoser: false }
    }
    const hasWinnerIds = winnerIds instanceof Set && winnerIds.size > 0
    const isWinner = Boolean(
        (hasWinnerIds && winnerIds.has(player.id)) ||
        (Number.isFinite(player.winnings) && player.winnings > 0)
    )
    const hasOutcome = isWinner || hasWinnerIds

    return {
        isWinner,
        isLoser: hasOutcome && !isWinner
    }
}

const drawTexasHeader = (ctx, metadata, cursorY) => {
    drawText(ctx, metadata.title || "Texas Hold'em", {
        x: CONFIG.canvasWidth / 2,
        y: cursorY,
        size: CONFIG.titleSize,
        color: CONFIG.textPrimary,
        align: "center",
        baseline: "top",
        bold: true
    })
    cursorY += CONFIG.titleSize + CONFIG.layout.titleSpacing

    const infoParts = []
    if (metadata.stage) infoParts.push(metadata.stage)
    if (metadata.round) infoParts.push(`Hand #${metadata.round}`)
    if (metadata.blinds) infoParts.push(`Blinds ${metadata.blinds}`)

    if (infoParts.length > 0) {
        drawText(ctx, infoParts.join(" • "), {
            x: CONFIG.canvasWidth / 2,
            y: cursorY,
            size: CONFIG.subtitleSize,
            color: CONFIG.textSecondary,
            align: "center",
            baseline: "top",
            bold: false
        })
        cursorY += CONFIG.subtitleSize + 18
    }

    // Draw POT badge instead of text
    const potAmount = metadata.potTotal ?? 0
    const potBadgeText = `POT ${setSeparator(potAmount)}$`
    // Measure text width to center the badge
    ctx.font = `700 ${CONFIG.valueSize}px "${CONFIG.fontFamily}"`
    const potTextWidth = ctx.measureText(potBadgeText).width
    const potBadgeWidth = potTextWidth + BADGE_PADDING_X * 2
    const potBadgeCenterX = CONFIG.canvasWidth / 2 - potBadgeWidth / 2

    drawBadge(ctx, potBadgeText, {
        x: potBadgeCenterX,
        y: cursorY,
        fill: BADGE_COLORS.pot,
        textColor: "#FFFFFF",
        fontSize: BADGE_FONT_SIZE,
        paddingX: BADGE_PADDING_X,
        paddingY: BADGE_PADDING_Y,
        bold: true,
        opacity: BADGE_OPACITY
    })
    cursorY += BADGE_FONT_SIZE + BADGE_PADDING_Y * 2 + CONFIG.layout.sectionTitleSpacing

    if (Array.isArray(metadata.sidePots) && metadata.sidePots.length > 1) {
        const details = metadata.sidePots
            .map((pot, index) => `Pot ${index + 1}: ${setSeparator(Math.floor(pot.amount || 0))}$`)
            .join(" • ")
        drawText(ctx, details, {
            x: CONFIG.canvasWidth / 2,
            y: cursorY,
            size: CONFIG.infoSize,
            color: CONFIG.textSecondary,
            align: "center",
            baseline: "top"
        })
        cursorY += CONFIG.infoSize + CONFIG.layout.sectionTitleSpacing
    }

    return cursorY
}

const drawEmptyCardSlot = (ctx, x, y) => {
    drawRoundedRect(ctx, x, y, CONFIG.cardWidth, CONFIG.cardHeight, 12)
    ctx.save()
    ctx.strokeStyle = "rgba(255,255,255,0.2)"
    ctx.lineWidth = 3
    ctx.setLineDash([10, 12])
    ctx.stroke()
    ctx.restore()
}

const drawCommunitySection = (ctx, state, cursorY) => {
    const cardsNeeded = 5
    const totalWidth = cardsNeeded * CONFIG.cardWidth + (cardsNeeded - 1) * CONFIG.cardSpacing
    const startX = CONFIG.canvasWidth / 2 - totalWidth / 2
    const cardsY = cursorY

    for (let i = 0; i < cardsNeeded; i++) {
        const x = startX + i * (CONFIG.cardWidth + CONFIG.cardSpacing)
        const cardName = state.boardCards[i]
        if (cardName) {
            const image = getCachedCardImage(cardName)
            if (image) drawCardImage(ctx, image, x, cardsY)
            else drawCardBack(ctx, x, cardsY)
        } else {
            drawEmptyCardSlot(ctx, x, cardsY)
        }
    }

    cursorY = cardsY + CONFIG.cardHeight + CONFIG.layout.cardsSpacing
    drawDivider(ctx, cursorY)
    return cursorY + CONFIG.layout.dividerOffset
}

const ACTION_BADGE_STYLES = {
    fold: { fill: CONFIG.loseColor, textColor: "#FFFFFF" },
    check: { fill: "#9CA3AF", textColor: "#FFFFFF" },
    call: { fill: "#2F80ED", textColor: "#FFFFFF" },
    bet: { fill: "#2F80ED", textColor: "#FFFFFF" },
    raise: { fill: "#2F80ED", textColor: "#FFFFFF" },
    allin: { fill: CONFIG.pushColor, textColor: "#2B1E00" }
}

const buildPlayerInfoSegments = (player, { includePot } = { includePot: true }) => {
    const segments = []
    const addSegment = (text, color = CONFIG.textSecondary) => {
        if (!text) return
        segments.push({ text, color })
    }

    if (player.gold != null && player.gold > 0) {
        addSegment(`Gold +${setSeparator(player.gold)}`, CONFIG.pushColor)
    }
    return segments
}

const drawTexasPlayer = (ctx, player, { slotLeft, slotWidth, top, showdown = false, winnerIds, includePot = true, minimal = false }) => {
    const padding = minimal ? TEXAS_LAYOUT.panelSlotPadding : TEXAS_LAYOUT.slotPadding
    const blockWidth = slotWidth - padding * 2
    const blockHeight = minimal ? TEXAS_LAYOUT.panelBlockHeight : TEXAS_LAYOUT.playerBlockHeight
    const blockX = slotLeft + padding
    const blockY = top

    if (!minimal) {
        drawRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, 18)
        ctx.save()
        if (player.eliminated || player.leftDuringPlay) {
            ctx.fillStyle = "rgba(0,0,0,0.45)"
        } else if (player.folded) {
            ctx.fillStyle = "rgba(0,0,0,0.35)"
        } else if (player.isActing) {
            ctx.fillStyle = "rgba(67, 198, 94, 0.35)"
        } else if (player.allIn) {
            ctx.fillStyle = "rgba(242, 201, 76, 0.25)"
        } else {
            ctx.fillStyle = "rgba(255,255,255,0.08)"
        }
        ctx.fill()
        ctx.restore()

        if (player.focus) {
            ctx.save()
            ctx.strokeStyle = "rgba(87, 194, 107, 0.9)"
            ctx.lineWidth = 4
            drawRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, 18)
            ctx.stroke()
            ctx.restore()
        }
    }

    const nameX = blockX + 24
    const nameY = blockY + 20
    const nameFont = `700 ${CONFIG.sectionTitleSize}px "${CONFIG.fontFamily}"`
    const nameLabel = player.label
    const nameWidth = minimal ? 0 : measureTextWidth(ctx, nameLabel, nameFont)
    if (!minimal) {
        drawText(ctx, nameLabel, {
            x: nameX,
            y: nameY,
            size: CONFIG.sectionTitleSize,
            color: CONFIG.textPrimary,
            align: "left",
            baseline: "top",
            bold: true
        })
    }

    const inlineBadges = []
    // During showdown, hide bet badge
    if (!minimal && !showdown && player.bet != null) {
        const betValue = Math.max(0, player.bet)
        inlineBadges.push({
            text: `${setSeparator(betValue)}$`,
            fill: BADGE_COLORS.allIn,
            textColor: "#FFFFFF",
            fontSize: BADGE_FONT_SIZE,
            paddingX: BADGE_PADDING_X,
            paddingY: BADGE_PADDING_Y,
            bold: true
        })
    }

    const statusBadges = []
    const { isWinner, isLoser } = resolvePlayerOutcome(player, { showdown, winnerIds })
    if (isWinner) statusBadges.push({ text: "WIN", fill: CONFIG.winColor, textColor: "#0B2B18" })
    else if (isLoser) statusBadges.push({ text: "LOSE", fill: CONFIG.loseColor, textColor: "#FFFFFF" })

    // During showdown: only show WIN/LOSE and hand rank (no action badges)
    // During normal play: show last action badges
    if (!showdown) {
        // Show last action badge (avoid duplicates with allIn, skip blind actions)
        if (!minimal && player.lastAction && player.lastAction.type && !player.lastAction.isBlind) {
            const style = ACTION_BADGE_STYLES[player.lastAction.type] || { fill: CONFIG.textSecondary, textColor: "#0B0B0B" }
            const actionText = player.lastAction.type === "allin" ? "ALL-IN" : String(player.lastAction.type).toUpperCase()
            statusBadges.push({
                text: actionText,
                fill: style.fill,
                textColor: style.textColor
            })
        } else if (player.allIn && !player.lastAction) {
            // Only show all-in badge if no action badge was already added
            const style = ACTION_BADGE_STYLES.allin
            statusBadges.push({ text: "ALL-IN", fill: style.fill, textColor: style.textColor })
        }

        // Avoid duplicate FOLD badge (may already be added from lastAction)
        if (player.folded && !statusBadges.some(b => b.text === "FOLD")) {
            statusBadges.push({ text: "FOLD", fill: CONFIG.loseColor, textColor: "#FFFFFF" })
        }
    }

    if (player.pendingRebuy && !statusBadges.some(b => b.text === "REBUY")) {
        statusBadges.push({ text: "REBUY", fill: "#F2C94C", textColor: "#2B1E00" })
    }

    // Always show LEFT badge (during both normal play and showdown) - avoid duplicates
    if (player.eliminated || player.leftDuringPlay) {
        // Only add once even if both flags are set
        const existingLeftBadge = statusBadges.some(b => b.text === "LEFT")
        if (!existingLeftBadge) {
            statusBadges.push({ text: "LEFT", fill: "#828282", textColor: "#FFFFFF" })
        }
    }

    // Always show hand rank (during both normal play and showdown)
    if (player.handRank && !player.folded) statusBadges.push({ text: player.handRank.toUpperCase(), fill: "#2F80ED", textColor: "#FFFFFF" })

    const normalizeBadge = (badge) => ({
        fontSize: BADGE_FONT_SIZE,
        paddingX: BADGE_PADDING_X,
        paddingY: BADGE_PADDING_Y,
        bold: true,
        ...badge
    })

    if (!minimal && inlineBadges.length > 0) {
        if (showdown) {
            // During showdown: stack badges vertically BELOW the name
            let badgeY = nameY + CONFIG.sectionTitleSize + 12
            inlineBadges.map(normalizeBadge).forEach((badge) => {
                drawBadge(ctx, badge.text, {
                    x: nameX,
                    y: badgeY,
                    fill: badge.fill,
                    textColor: badge.textColor,
                    fontSize: badge.fontSize,
                    paddingX: badge.paddingX,
                    paddingY: badge.paddingY,
                    bold: Boolean(badge.bold),
                    opacity: BADGE_OPACITY
                })
                badgeY += BADGE_FONT_SIZE + BADGE_PADDING_Y * 2 + 8
            })
        } else {
            // Normal mode: stack badges horizontally
            let badgeX = nameX + nameWidth + 18
            inlineBadges.map(normalizeBadge).forEach((badge, index) => {
                const fontSize = badge.fontSize
                const paddingX = badge.paddingX
                const paddingY = badge.paddingY
                const metrics = drawBadge(ctx, badge.text, {
                    x: badgeX,
                    y: nameY,
                    fill: badge.fill,
                    textColor: badge.textColor,
                    fontSize,
                    paddingX,
                    paddingY,
                    bold: Boolean(badge.bold),
                    opacity: BADGE_OPACITY
                })
                badgeX += metrics.width + (index < inlineBadges.length - 1 ? 12 : 0)
            })
        }
    }

    // Calculate where inline badges end (for status badges positioning during showdown)
    let inlineBadgesHeight = 0
    if (showdown && inlineBadges.length > 0) {
        inlineBadgesHeight = (BADGE_FONT_SIZE + BADGE_PADDING_Y * 2 + 8) * inlineBadges.length
    }

    let infoCursorY = minimal ? nameY : nameY + CONFIG.sectionTitleSize + 12
    if (!minimal && statusBadges.length > 0) {
        if (showdown) {
            // During showdown: stack badges vertically BELOW inline badges
            let badgeY = nameY + CONFIG.sectionTitleSize + 12 + inlineBadgesHeight
            statusBadges.map(normalizeBadge).forEach((badge) => {
                drawBadge(ctx, badge.text, {
                    x: nameX,
                    y: badgeY,
                    fill: badge.fill,
                    textColor: badge.textColor,
                    fontSize: badge.fontSize,
                    paddingX: badge.paddingX,
                    paddingY: badge.paddingY,
                    bold: Boolean(badge.bold),
                    opacity: BADGE_OPACITY
                })
                badgeY += BADGE_FONT_SIZE + BADGE_PADDING_Y * 2 + 8
            })
        } else {
            // Normal mode: stack badges horizontally
            let badgeX = nameX
            statusBadges.map(normalizeBadge).forEach((badge, index) => {
                const fontSize = badge.fontSize
                const paddingX = badge.paddingX
                const paddingY = badge.paddingY
                const metrics = drawBadge(ctx, badge.text, {
                    x: badgeX,
                    y: infoCursorY,
                    fill: badge.fill,
                    textColor: badge.textColor,
                    fontSize,
                    paddingX,
                    paddingY,
                    bold: Boolean(badge.bold),
                    opacity: BADGE_OPACITY
                })
                badgeX += metrics.width + (index < statusBadges.length - 1 ? 12 : 0)
            })
        }
        infoCursorY += BADGE_FONT_SIZE + BADGE_PADDING_Y * 2 + 10
    }
    if (!minimal) {
        const infoSegments = buildPlayerInfoSegments(player, { includePot })
        if (infoSegments.length > 0) {
            drawInfoLine(ctx, infoSegments, {
                startX: nameX,
                y: infoCursorY,
                fontSize: CONFIG.infoSize,
                align: "left",
                defaultColor: CONFIG.textSecondary
            })
            infoCursorY += CONFIG.infoSize + 10
        }

        const stackAmount = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0
        if (stackAmount > 0) {
            const stackBadgeText = `STACK ${setSeparator(stackAmount)}$`
            drawBadge(ctx, stackBadgeText, {
                x: blockX + 16,
                y: blockY + blockHeight - BADGE_FONT_SIZE - 20,
                fill: BADGE_COLORS.stack,
                textColor: CONFIG.textPrimary,
                fontSize: BADGE_FONT_SIZE,
                paddingX: BADGE_PADDING_X,
                paddingY: BADGE_PADDING_Y,
                bold: true,
                opacity: BADGE_OPACITY
            })
        }
    }

    drawTexasPlayerCards(ctx, player, blockX, blockY, blockWidth, blockHeight, { minimal })
    return blockY + blockHeight
}

function drawTexasPlayerCards(ctx, player, blockX, blockY, blockWidth, blockHeight, { minimal = false } = {}) {
    const cards = Math.max(2, player.cards.length || 2)
    const showCards = Boolean(player.showCards)

    // Use smaller cards when cards are hidden (not shown)
    const cardWidth = showCards ? CONFIG.cardWidth : 124
    const cardHeight = showCards ? CONFIG.cardHeight : 178

    // Stack cards with a slight diagonal overlap
    const stackOffsetX = 19
    const stackOffsetY = 27

    const totalWidth = cardWidth + (cards - 1) * stackOffsetX
    const totalHeight = cardHeight + (cards - 1) * stackOffsetY

    const cardsY = minimal
        ? blockY + (blockHeight - totalHeight) / 2
        : blockY + blockHeight - totalHeight - 24

    const startX = minimal
        ? blockX + (blockWidth - totalWidth) / 2
        : blockX + blockWidth - totalWidth - 24

    for (let i = 0; i < cards; i++) {
        const x = startX + i * stackOffsetX
        const y = cardsY + i * stackOffsetY
        const cardName = player.cards[i]

        if (cardName && showCards) {
            const image = getCachedCardImage(cardName)
            if (image) {
                drawCardImage(ctx, image, x, y)
                continue
            }
        }

        // Draw hidden cards
        drawCardBack(ctx, x, y)
    }
}

async function renderTexasPlayerPanel({ player }) {
    if (!player) return null
    const state = createTexasTableState({
        players: [player]
    }, {
        focusPlayerId: player?.id,
        showdown: Boolean(player?.showCards),
        revealFocusCards: Boolean(player?.showCards)
    })

    const normalizedPlayer = state.players?.[0]
    if (!normalizedPlayer) return null
    const winnerIds = collectWinnerIds(state)

    await ensureCardBackLoaded()
    const cardsToPreload = collectCardsToPreload(state)
    if (cardsToPreload.length > 0) {
        await preloadCards(cardsToPreload)
    }

    const canvas = createCanvas(PLAYER_PANEL_CONFIG.width, PLAYER_PANEL_CONFIG.height)
    const ctx = canvas.getContext("2d")
    drawBackground(ctx, PLAYER_PANEL_CONFIG.height)

    drawTexasPlayer(ctx, normalizedPlayer, {
        slotLeft: 0,
        slotWidth: PLAYER_PANEL_CONFIG.width,
        top: PLAYER_PANEL_CONFIG.topPadding,
        showdown: Boolean(state.metadata?.showdown),
        winnerIds,
        includePot: false,
        minimal: true
    })

    const targetWidth = Math.max(1, Math.round(PLAYER_PANEL_CONFIG.width * PLAYER_PANEL_SCALE))
    const targetHeight = Math.max(1, Math.round(PLAYER_PANEL_CONFIG.height * PLAYER_PANEL_SCALE))
    let buffer = null
    try {
        buffer = await downscaleCanvasToPng(canvas, targetWidth, targetHeight, CONFIG.embedCompressionLevel)
    } catch (error) {
        logger.warn("Failed to downscale Texas player panel, falling back to raw render", {
            scope: "texasTableRenderer",
            error: error?.message
        })
    }

    if (!buffer || buffer.length === 0) {
        try {
            buffer = await renderCanvasToPng(canvas, CONFIG.embedCompressionLevel)
        } catch (error) {
            logger.warn("Failed to render Texas player panel fallback", {
                scope: "texasTableRenderer",
                error: error?.message
            })
            return null
        }
    }

    return buffer
}

async function renderTexasTable(params = {}) {
    const requestedFormat = typeof params?.outputFormat === "string"
        ? params.outputFormat.toLowerCase()
        : "png"
    const normalized = params?.sanitizedParams
        ? params.sanitizedParams
        : createTexasTableState(params, params.options || {})
    const winnerIds = collectWinnerIds(normalized)
    const showdown = Boolean(normalized.metadata?.showdown)

    const wantsSVG = requestedFormat === "svg"
    const scale = wantsSVG ? 1 : (Number.isFinite(CONFIG.outputScale) && CONFIG.outputScale > 0 ? CONFIG.outputScale : 1)
    const totalPlayers = normalized.players.length
    const maxPerRow = TEXAS_LAYOUT.maxPlayersPerRow
    const totalRows = totalPlayers > 0 ? Math.ceil(totalPlayers / maxPerRow) : 0
    const additionalRows = Math.max(0, totalRows - (CONFIG.layout.basePlayerRows || 1))
    const canvasHeight = CONFIG.canvasHeight + additionalRows * (CONFIG.layout.rowHeightIncrement || 320)

    const canvas = createCanvas(
        wantsSVG ? CONFIG.canvasWidth : Math.round(CONFIG.canvasWidth * scale),
        wantsSVG ? canvasHeight : Math.round(canvasHeight * scale),
        wantsSVG ? "svg" : undefined
    )
    const ctx = canvas.getContext("2d")
    if (!wantsSVG && scale !== 1) {
        ctx.scale(scale, scale)
    }

    await ensureCardBackLoaded()
    const cardsToPreload = collectCardsToPreload(normalized)
    if (cardsToPreload.length > 0) {
        await preloadCards(cardsToPreload)
    }

    drawBackground(ctx, canvasHeight)

    let cursorY = CONFIG.layout.topMargin
    cursorY = drawTexasHeader(ctx, normalized.metadata, cursorY)
    cursorY = drawCommunitySection(ctx, normalized, cursorY)

    const playerRowTop = cursorY + CONFIG.layout.playersTopSpacing
    let playerIndex = 0
    let rowsRemaining = Math.max(1, totalRows)
    let rowTop = playerRowTop

    // Fixed slot width based on maxPerRow (always 2 columns layout)
    const fixedSlotWidth = CONFIG.canvasWidth / maxPerRow

    while (playerIndex < totalPlayers && rowsRemaining > 0) {
        const playersRemaining = totalPlayers - playerIndex
        const slotsThisRow = Math.min(maxPerRow, Math.max(1, Math.ceil(playersRemaining / rowsRemaining)))

        // Center the row if fewer players than maxPerRow
        const rowOffset = slotsThisRow < maxPerRow
            ? (CONFIG.canvasWidth - slotsThisRow * fixedSlotWidth) / 2
            : 0

        let rowBottom = rowTop
        for (let slotIndex = 0; slotIndex < slotsThisRow && playerIndex < totalPlayers; slotIndex++) {
            const player = normalized.players[playerIndex]
            if (!player) {
                playerIndex += 1
                continue
            }
            const slotLeft = rowOffset + fixedSlotWidth * slotIndex
            const handBottom = drawTexasPlayer(ctx, player, {
                slotLeft,
                slotWidth: fixedSlotWidth,
                top: rowTop,
                showdown,
                winnerIds,
                includePot: true
            })
            rowBottom = Math.max(rowBottom, handBottom)
            playerIndex += 1
        }
        rowsRemaining -= 1
        rowTop = playerIndex < totalPlayers
            ? rowBottom + TEXAS_LAYOUT.rowGap
            : rowBottom
    }

    const baseBuffer = canvas.toBuffer(wantsSVG ? "image/svg+xml" : "image/png")

    if (wantsSVG && ENABLE_RENDER_DEBUG) {
        try {
            await fs.writeFile(DEBUG_SVG_PATH, baseBuffer)
        } catch (error) {
            logger.debug("Failed to store Texas render debug SVG", {
                scope: "texasTableRenderer",
                error: error.message
            })
        }
        return baseBuffer
    }

    if (wantsSVG) {
        return baseBuffer
    }

    if (ENABLE_RENDER_DEBUG) {
        try {
            await fs.writeFile(DEBUG_PNG_PATH, baseBuffer)
        } catch (error) {
            logger.debug("Failed to store Texas render debug PNG", {
                scope: "texasTableRenderer",
                error: error.message
            })
        }
    }

    if (Number.isFinite(CONFIG.embedTargetWidth) && CONFIG.embedTargetWidth > 0) {
        try {
            const targetWidth = CONFIG.embedTargetWidth
            const sourceWidth = canvas.width
            const aspectRatio = canvas.height / canvas.width
            const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio))

            if (targetWidth < sourceWidth) {
                return downscaleCanvasToPng(canvas, targetWidth, targetHeight, CONFIG.embedCompressionLevel)
            }
        } catch (error) {
            logger.debug("Failed to downscale Texas table render", {
                scope: "texasTableRenderer",
                error: error.message
            })
        }
    }

    return baseBuffer
}

module.exports = {
    renderTexasTable,
    createTexasTableState,
    renderTexasPlayerPanel,
    clearTexasRenderCache: clearImageCache
}
