const path = require("path")
const { createCanvas, loadImage } = require("canvas")
const logger = require("../../utils/logger")
const { gameToImage, isValidGameCard } = require("../../utils/cardConverter")

const PROJECT_ROOT = path.join(__dirname, "../../..")

const DEBUG_PNG_PATH = path.join(PROJECT_ROOT, "render-debug.png")
const DEBUG_SVG_PATH = path.join(PROJECT_ROOT, "render-debug.svg")
const ENABLE_RENDER_DEBUG = process.env.CARD_RENDER_DEBUG === "1"
const DEFAULT_PNG_COMPRESSION = 8

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
        playerRowGap: 50,
        maxParticipantsPerRow: 2,
        basePlayerRows: 1,
        rowHeightIncrement: 320,
        sectionTitleSpacing: 18,
        subtitleSpacing: 6,
        cardsSpacing: 22,
        valueSpacing: 18,
        infoSpacing: 12,
        sectionBottomPadding: 28
    }
})

const MAX_CARD_CACHE_SIZE = Number(process.env.CARD_RENDER_MAX_CACHE_SIZE) || 120
const MAX_BACKGROUND_CACHE_SIZE = Number(process.env.CARD_RENDER_MAX_BACKGROUND_CACHE_SIZE) || 8

const cardCache = new Map()
const backgroundLayerCache = new Map()

let cardBackPromise = null
let backgroundNoiseCanvas = null

const clampCompressionLevel = (value) => {
    if (!Number.isFinite(value)) return DEFAULT_PNG_COMPRESSION
    return Math.min(9, Math.max(0, Math.round(value)))
}

const renderCanvasToPng = (canvas, compressionLevel = DEFAULT_PNG_COMPRESSION) => {
    return canvas.toBuffer("image/png", { compressionLevel: clampCompressionLevel(compressionLevel) })
}

const downscaleCanvasToPng = (sourceCanvas, targetWidth, targetHeight, compressionLevel) => {
    const scaledCanvas = createCanvas(Math.max(1, targetWidth), Math.max(1, targetHeight))
    const scaledCtx = scaledCanvas.getContext("2d")
    scaledCtx.imageSmoothingEnabled = true
    scaledCtx.imageSmoothingQuality = "high"
    scaledCtx.patternQuality = "best"
    scaledCtx.quality = "best"
    scaledCtx.antialias = "subpixel"
    scaledCtx.drawImage(
        sourceCanvas,
        0,
        0,
        sourceCanvas.width,
        sourceCanvas.height,
        0,
        0,
        scaledCanvas.width,
        scaledCanvas.height
    )
    return renderCanvasToPng(scaledCanvas, compressionLevel)
}

const enforceCacheLimit = (cache, limit) => {
    if (!Number.isFinite(limit) || limit < 1) return
    while (cache.size > limit) {
        const oldestKey = cache.keys().next().value
        if (oldestKey === undefined) break
        cache.delete(oldestKey)
    }
}

const touchCacheEntry = (cache, key) => {
    if (!cache.has(key)) return undefined
    const value = cache.get(key)
    cache.delete(key)
    cache.set(key, value)
    return value
}

const normalizeCardName = (card) => {
    if (!card || typeof card !== "string") {
        throw new Error(`Invalid card name ${card}`)
    }
    if (card.length === 2 && isValidGameCard(card)) {
        return gameToImage(card)
    }
    return card
}

async function ensureCardBackLoaded() {
    if (cardCache.has("__card_back__")) return
    if (!cardBackPromise) {
        cardBackPromise = loadImage(CONFIG.cardBackImage)
            .then((image) => {
                cardCache.set("__card_back__", image)
                enforceCacheLimit(cardCache, MAX_CARD_CACHE_SIZE)
                return image
            })
            .catch((error) => {
                logger.error("Failed to load card back image", {
                    scope: "cardRenderCore",
                    path: CONFIG.cardBackImage,
                    error: error.message
                })
                return null
            })
    }
    await cardBackPromise
}

async function loadCardImage(cardName) {
    const normalized = normalizeCardName(cardName)
    if (cardCache.has(normalized)) {
        return touchCacheEntry(cardCache, normalized)
    }

    const cardPath = path.join(CONFIG.cardsPath, `${normalized}.png`)
    try {
        const image = await loadImage(cardPath)
        cardCache.set(normalized, image)
        enforceCacheLimit(cardCache, MAX_CARD_CACHE_SIZE)
        return image
    } catch (error) {
        logger.error("Unable to load card asset", {
            scope: "cardRenderCore",
            cardName: normalized,
            cardPath,
            error: error.message
        })
        return null
    }
}

async function preloadCards(cardNames = []) {
    await ensureCardBackLoaded()
    await Promise.all(
        (cardNames || []).map((card) =>
            loadCardImage(card).catch((error) => {
                logger.warn("Failed to preload card asset", {
                    scope: "cardRenderCore",
                    cardName: card,
                    message: error?.message
                })
                return null
            })
        )
    )
}

function clearImageCache() {
    cardCache.clear()
    backgroundLayerCache.clear()
    backgroundNoiseCanvas = null
    cardBackPromise = null
}

const createSeededRandom = (seed = 0xdecafbad) => {
    let state = seed >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 0x100000000
    }
}

const getBackgroundNoiseCanvas = (size = 64) => {
    if (backgroundNoiseCanvas) {
        return backgroundNoiseCanvas
    }
    const noiseCanvas = createCanvas(size, size)
    const nctx = noiseCanvas.getContext("2d")
    const imageData = nctx.createImageData(size, size)
    const data = imageData.data
    const random = createSeededRandom()
    for (let i = 0; i < data.length; i += 4) {
        const shade = 22 + random() * 32
        data[i] = shade
        data[i + 1] = shade * 0.95
        data[i + 2] = shade * 0.9
        data[i + 3] = 255
    }
    nctx.putImageData(imageData, 0, 0)
    backgroundNoiseCanvas = noiseCanvas
    return noiseCanvas
}

const createBackgroundLayer = (height) => {
    const layer = createCanvas(CONFIG.canvasWidth, height)
    const layerCtx = layer.getContext("2d")
    const width = CONFIG.canvasWidth

    const radial = layerCtx.createRadialGradient(width / 2, height / 2, width * 0.22, width / 2, height / 2, width)
    radial.addColorStop(0, "#179252")
    radial.addColorStop(0.55, CONFIG.backgroundTop)
    radial.addColorStop(1, "#12432C")
    layerCtx.fillStyle = radial
    layerCtx.fillRect(0, 0, width, height)

    const bandHeight = height * 0.2
    const bandY = height * 0.24
    const bandGradient = layerCtx.createRadialGradient(width / 2, bandY + bandHeight / 2, width * 0.1, width / 2, bandY + bandHeight / 2, width * 0.65)
    bandGradient.addColorStop(0, "rgba(255,255,255,0.05)")
    bandGradient.addColorStop(1, "rgba(255,255,255,0)")
    layerCtx.save()
    layerCtx.globalAlpha = 0.35
    layerCtx.fillStyle = bandGradient
    layerCtx.fillRect(0, bandY, width, bandHeight)
    layerCtx.restore()

    const edgeGlow = layerCtx.createRadialGradient(width / 2, height / 2, width * 0.45, width / 2, height / 2, width * 1.2)
    edgeGlow.addColorStop(0, "rgba(255,255,255,0)")
    edgeGlow.addColorStop(1, "rgba(255,255,255,0.04)")
    layerCtx.save()
    layerCtx.globalCompositeOperation = "lighter"
    layerCtx.fillStyle = edgeGlow
    layerCtx.fillRect(0, 0, width, height)
    layerCtx.restore()

    const bottomGlow = layerCtx.createLinearGradient(0, height * 0.62, 0, height)
    bottomGlow.addColorStop(0, "rgba(0,0,0,0)")
    bottomGlow.addColorStop(1, "rgba(0,0,0,0.32)")
    layerCtx.save()
    layerCtx.fillStyle = bottomGlow
    layerCtx.fillRect(0, 0, width, height)
    layerCtx.restore()

    const noiseCanvas = getBackgroundNoiseCanvas()
    const pattern = layerCtx.createPattern(noiseCanvas, "repeat")
    if (pattern) {
        layerCtx.save()
        layerCtx.globalAlpha = 0.07
        layerCtx.fillStyle = pattern
        layerCtx.fillRect(0, 0, width, height)
        layerCtx.restore()
    }

    const vignette = layerCtx.createRadialGradient(width / 2, height / 2, width * 0.55, width / 2, height / 2, width * 1.05)
    vignette.addColorStop(0, "rgba(0,0,0,0)")
    vignette.addColorStop(1, "rgba(0,0,0,0.45)")
    layerCtx.save()
    layerCtx.fillStyle = vignette
    layerCtx.fillRect(0, 0, width, height)
    layerCtx.restore()

    return layer
}

const getBackgroundLayer = (height) => {
    if (backgroundLayerCache.has(height)) {
        return touchCacheEntry(backgroundLayerCache, height)
    }
    const layer = createBackgroundLayer(height)
    backgroundLayerCache.set(height, layer)
    enforceCacheLimit(backgroundLayerCache, MAX_BACKGROUND_CACHE_SIZE)
    return layer
}

const drawBackground = (ctx, canvasHeight) => {
    const layer = getBackgroundLayer(canvasHeight)
    ctx.drawImage(layer, 0, 0)
}

const drawDivider = (ctx, y) => {
    ctx.strokeStyle = CONFIG.dividerColor
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(CONFIG.canvasWidth * 0.12, y)
    ctx.lineTo(CONFIG.canvasWidth * 0.88, y)
    ctx.stroke()
}

const drawText = (ctx, text, {
    x,
    y,
    size,
    color,
    align = "center",
    baseline = "middle",
    bold = false,
    shadow = false
}) => {
    if (!text) return
    const font = `${bold ? "700" : "400"} ${size}px "${CONFIG.fontFamily}"`
    ctx.font = font
    ctx.textAlign = align
    ctx.textBaseline = baseline

    if (shadow) {
        ctx.save()
        ctx.shadowColor = CONFIG.shadow.color
        ctx.shadowBlur = CONFIG.shadow.blur * 0.6
        ctx.shadowOffsetX = CONFIG.shadow.offsetX * 0.4
        ctx.shadowOffsetY = CONFIG.shadow.offsetY * 0.4
        ctx.fillStyle = color
        ctx.fillText(text, x, y)
        ctx.restore()
    }

    ctx.fillStyle = color
    ctx.fillText(text, x, y)
}

const drawRoundedRect = (ctx, x, y, width, height, radius) => {
    ctx.beginPath()
    ctx.moveTo(x + radius, y)
    ctx.lineTo(x + width - radius, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius)
    ctx.lineTo(x + width, y + height - radius)
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    ctx.lineTo(x + radius, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius)
    ctx.lineTo(x, y + radius)
    ctx.quadraticCurveTo(x, y, x + radius, y)
    ctx.closePath()
}

const drawCardBack = (ctx, x, y) => {
    const back = cardCache.get("__card_back__")
    if (back) {
        ctx.drawImage(back, x, y, CONFIG.cardWidth, CONFIG.cardHeight)
    } else {
        drawRoundedRect(ctx, x, y, CONFIG.cardWidth, CONFIG.cardHeight, 12)
        ctx.fillStyle = "#1F5F3C"
        ctx.fill()
        ctx.strokeStyle = "rgba(255,255,255,0.25)"
        ctx.lineWidth = 4
        drawRoundedRect(ctx, x + 12, y + 12, CONFIG.cardWidth - 24, CONFIG.cardHeight - 24, 10)
        ctx.stroke()
    }
}

const drawCardImage = (ctx, image, x, y) => {
    ctx.drawImage(image, x, y, CONFIG.cardWidth, CONFIG.cardHeight)
}

const getCachedCardImage = (cardName) => {
    if (!cardName) return null
    try {
        return cardCache.get(normalizeCardName(cardName)) || null
    } catch (_) {
        return null
    }
}

const measureTextWidth = (ctx, text, font) => {
    ctx.save()
    ctx.font = font
    const width = ctx.measureText(text).width
    ctx.restore()
    return width
}

module.exports = {
    CONFIG,
    PROJECT_ROOT,
    DEBUG_PNG_PATH,
    DEBUG_SVG_PATH,
    ENABLE_RENDER_DEBUG,
    createCanvas,
    loadCardImage,
    renderCanvasToPng,
    downscaleCanvasToPng,
    ensureCardBackLoaded,
    preloadCards,
    clearImageCache,
    drawBackground,
    drawDivider,
    drawText,
    drawRoundedRect,
    drawCardBack,
    drawCardImage,
    measureTextWidth,
    getCachedCardImage
}
