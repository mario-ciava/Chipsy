const fs = require("fs/promises")
const logger = require("../utils/logger")
const setSeparator = require("../utils/setSeparator")
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

const TEXAS_LAYOUT = {
    maxPlayersPerRow: 3,
    blockGap: 40,
    rowGap: 60,
    slotPadding: 26,
    playerBlockHeight: CONFIG.cardHeight + 120
}

const PLAYER_PANEL_CONFIG = {
    width: 520,
    height: TEXAS_LAYOUT.playerBlockHeight + 80,
    topPadding: 30,
    targetWidth: 260
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

function normalizeTexasPlayers(players = [], { showdown, focusPlayerId, revealFocusCards }) {
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
            (revealFocusCards && focusPlayerId && player?.id === focusPlayerId)
        )
        const stack = sanitizeChips(player?.stack)
        const bet = sanitizeChips(player?.bet)
        const totalBet = sanitizeChips(player?.totalBet)
        const winnings = sanitizeChips(player?.winnings)
        const gold = sanitizeChips(player?.gold)

        const folded = Boolean(player?.folded ?? player?.status?.folded)
        const allIn = Boolean(player?.allIn ?? player?.status?.allIn)
        const eliminated = Boolean(player?.eliminated ?? player?.status?.removed)
        const isActing = Boolean(player?.isActing ?? player?.isCurrent ?? ((focusPlayerId && player?.id === focusPlayerId) && !showdown))
        const allInAmount = allIn ? sanitizeChips(player?.allInAmount ?? totalBet ?? bet) : null

        const handRank = showdown ? (player?.handRank || player?.hand?.name || null) : null
        const statusLabel =
            player?.statusLabel ||
            (eliminated ? "Left table" : null) ||
            (folded ? "Folded" : null)

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
            isActing,
            statusLabel,
            focus: Boolean(focusPlayerId && player?.id === focusPlayerId),
            handRank
        }
    })
}

function createTexasTableState(rawState = {}, options = {}) {
    const showdown = Boolean(options.showdown ?? rawState.showdown)
    const focusPlayerId = options.focusPlayerId ?? rawState.focusPlayerId ?? null
    const revealFocusCards = Boolean(options.revealFocusCards ?? rawState.revealFocusCards)
    const boardCards = Array.isArray(rawState.boardCards) ? rawState.boardCards.filter(Boolean) : []
    const potTotal = sanitizeChips(rawState.potTotal)
    const sidePots = Array.isArray(rawState.sidePots) ? rawState.sidePots.filter(pot => Number.isFinite(pot?.amount)) : []
    const round = options.round ?? rawState.round ?? rawState.metadata?.round
    const blinds = options.blinds ?? rawState.blinds ?? rawState.metadata?.blinds ?? null
    const stage = resolveStageLabel(options.stage ?? rawState.stage, boardCards.length)

    return {
        boardCards,
        players: normalizeTexasPlayers(rawState.players || [], { showdown, focusPlayerId, revealFocusCards }),
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

    const potText = metadata.potTotal != null
        ? `Pot: ${setSeparator(metadata.potTotal)}$`
        : "Pot: 0$"
    drawText(ctx, potText, {
        x: CONFIG.canvasWidth / 2,
        y: cursorY,
        size: CONFIG.valueSize,
        color: CONFIG.textPrimary,
        align: "center",
        baseline: "top",
        bold: true
    })
    cursorY += CONFIG.valueSize + CONFIG.layout.sectionTitleSpacing

    if (Array.isArray(metadata.sidePots) && metadata.sidePots.length > 0) {
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

const buildPlayerInfoSegments = (player) => {
    const segments = []
    const addSegment = (text, color = CONFIG.textSecondary) => {
        if (!text) return
        segments.push({ text, color })
    }
    if (player.totalBet != null && player.totalBet > 0) {
        addSegment(`In pot ${setSeparator(player.totalBet)}$`)
    }
    if (
        player.bet != null &&
        player.bet > 0 &&
        player.totalBet != null &&
        player.bet !== player.totalBet
    ) {
        addSegment(`This round ${setSeparator(player.bet)}$`)
    }
    if (player.winnings != null && player.winnings > 0) {
        addSegment(`Won +${setSeparator(player.winnings)}$`, CONFIG.winColor)
    }
    if (player.gold != null && player.gold > 0) {
        addSegment(`Gold +${setSeparator(player.gold)}`, CONFIG.pushColor)
    }
    return segments
}

const drawTexasPlayer = (ctx, player, { slotLeft, slotWidth, top }) => {
    const padding = TEXAS_LAYOUT.slotPadding
    const blockWidth = slotWidth - padding * 2
    const blockHeight = TEXAS_LAYOUT.playerBlockHeight
    const blockX = slotLeft + padding
    const blockY = top

    drawRoundedRect(ctx, blockX, blockY, blockWidth, blockHeight, 18)
    ctx.save()
    if (player.folded) {
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

    const nameX = blockX + 24
    const nameY = blockY + 20
    const nameFont = `700 ${CONFIG.sectionTitleSize}px "${CONFIG.fontFamily}"`
    const nameWidth = measureTextWidth(ctx, player.label, nameFont)
    drawText(ctx, player.label, {
        x: nameX,
        y: nameY,
        size: CONFIG.sectionTitleSize,
        color: CONFIG.textPrimary,
        align: "left",
        baseline: "top",
        bold: true
    })

    const inlineBadges = []
    if (player.isActing) inlineBadges.push({ text: "ACTING", fill: CONFIG.winColor, textColor: "#0B2B18" })
    if (player.allIn) {
        const amountLabel = player.allInAmount != null ? `ALL-IN ${setSeparator(player.allInAmount)}$` : "ALL-IN"
        inlineBadges.push({ text: amountLabel, fill: CONFIG.pushColor, textColor: "#2B1E00" })
    }
    if (player.folded) inlineBadges.push({ text: "FOLDED", fill: CONFIG.loseColor, textColor: "#FFFFFF" })
    if (player.handRank && !player.folded) inlineBadges.push({ text: player.handRank.toUpperCase(), fill: "#2F80ED", textColor: "#FFFFFF" })

    if (inlineBadges.length > 0) {
        let badgeX = nameX + nameWidth + 18
        const badgeY = nameY + Math.max(0, (CONFIG.sectionTitleSize - CONFIG.infoSize) / 2)
        inlineBadges.forEach((badge, index) => {
            const metrics = drawBadge(ctx, badge.text, {
                x: badgeX,
                y: badgeY,
                fill: badge.fill,
                textColor: badge.textColor,
                fontSize: CONFIG.infoSize,
                paddingX: 12,
                paddingY: 4
            })
            badgeX += metrics.width + (index < inlineBadges.length - 1 ? 12 : 0)
        })
    }

    let infoCursorY = nameY + CONFIG.sectionTitleSize + 18
    if (player.stack != null) {
        const stackMetrics = drawBadge(ctx, `${setSeparator(player.stack)}$`, {
            x: nameX,
            y: infoCursorY,
            fill: "rgba(242, 201, 76, 0.25)",
            textColor: "#F2C94C",
            fontSize: CONFIG.valueSize,
            paddingX: 18,
            paddingY: 10,
            bold: true,
            opacity: 1
        })
        infoCursorY += stackMetrics.height + 16
    }

    const infoSegments = buildPlayerInfoSegments(player)
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

    drawTexasPlayerCards(ctx, player, blockX, blockY, blockWidth)
    return blockY + blockHeight
}

function drawTexasPlayerCards(ctx, player, blockX, blockY, blockWidth) {
    const cardsY = blockY + TEXAS_LAYOUT.playerBlockHeight - CONFIG.cardHeight - 24
    const cards = Math.max(2, player.cards.length || 2)
    const totalWidth = cards * CONFIG.cardWidth + (cards - 1) * 12
    const startX = blockX + blockWidth - totalWidth - 24

    for (let i = 0; i < cards; i++) {
        const x = startX + i * (CONFIG.cardWidth + 12)
        const cardName = player.cards[i]
        if (cardName && player.showCards) {
            const image = getCachedCardImage(cardName)
            if (image) {
                drawCardImage(ctx, image, x, cardsY)
                continue
            }
        }
        drawCardBack(ctx, x, cardsY)
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
        top: PLAYER_PANEL_CONFIG.topPadding
    })

    const targetWidth = PLAYER_PANEL_CONFIG.targetWidth
    if (Number.isFinite(targetWidth) && targetWidth > 0 && targetWidth < PLAYER_PANEL_CONFIG.width) {
        const aspectRatio = PLAYER_PANEL_CONFIG.height / PLAYER_PANEL_CONFIG.width
        const targetHeight = Math.max(1, Math.round(targetWidth * aspectRatio))
        return downscaleCanvasToPng(canvas, targetWidth, targetHeight, CONFIG.embedCompressionLevel)
    }
    return renderCanvasToPng(canvas, CONFIG.embedCompressionLevel)
}

async function renderTexasTable(params = {}) {
    const requestedFormat = typeof params?.outputFormat === "string"
        ? params.outputFormat.toLowerCase()
        : "png"
    const normalized = params?.sanitizedParams
        ? params.sanitizedParams
        : createTexasTableState(params, params.options || {})

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
    while (playerIndex < totalPlayers && rowsRemaining > 0) {
        const playersRemaining = totalPlayers - playerIndex
        const slotsThisRow = Math.min(maxPerRow, Math.max(1, Math.ceil(playersRemaining / rowsRemaining)))
        const slotWidth = CONFIG.canvasWidth / slotsThisRow
        let rowBottom = rowTop
        for (let slotIndex = 0; slotIndex < slotsThisRow && playerIndex < totalPlayers; slotIndex++) {
            const player = normalized.players[playerIndex]
            if (!player) {
                playerIndex += 1
                continue
            }
            const slotLeft = slotWidth * slotIndex
            const handBottom = drawTexasPlayer(ctx, player, {
                slotLeft,
                slotWidth,
                top: rowTop
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
