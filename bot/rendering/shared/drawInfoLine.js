const { CONFIG, drawText, measureTextWidth } = require("../core/cardRenderBase")

const DEFAULT_SEPARATOR = " • "

const buildInfoFont = (fontSize = CONFIG.infoSize, bold = false, fontFamily = CONFIG.fontFamily) => {
    const weight = bold ? "700" : "400"
    return `${weight} ${fontSize}px "${fontFamily}"`
}

const drawInfoLine = (ctx, segments, options = {}) => {
    if (!Array.isArray(segments) || segments.length === 0) {
        return 0
    }

    const fontSize = options.fontSize ?? CONFIG.infoSize
    const bold = Boolean(options.bold)
    const fontFamily = options.fontFamily ?? CONFIG.fontFamily
    const font = buildInfoFont(fontSize, bold, fontFamily)
    const separator = options.separator ?? DEFAULT_SEPARATOR
    const separatorColor = options.separatorColor || options.defaultColor || CONFIG.textSecondary
    const separatorWidth = measureTextWidth(ctx, separator, font)
    const defaultColor = options.defaultColor || CONFIG.textSecondary
    const centerX = Number.isFinite(options.centerX) ? options.centerX : CONFIG.canvasWidth / 2
    const hasStartX = Number.isFinite(options.startX)
    const useLeftAlign = options.align === "left" && hasStartX
    const y = options.y ?? 0

    const totalWidth = segments.reduce((acc, segment, index) => {
        const segmentWidth = measureTextWidth(ctx, segment.text, font)
        return acc + segmentWidth + (index > 0 ? separatorWidth : 0)
    }, 0)

    let cursorX = useLeftAlign ? options.startX : centerX - totalWidth / 2
    segments.forEach((segment, index) => {
        if (index > 0) {
            drawText(ctx, separator, {
                x: cursorX,
                y,
                size: fontSize,
                color: separatorColor,
                align: "left",
                baseline: "top",
                bold
            })
            cursorX += separatorWidth
        }

        drawText(ctx, segment.text, {
            x: cursorX,
            y,
            size: fontSize,
            color: segment.color || defaultColor,
            align: "left",
            baseline: "top",
            bold
        })
        cursorX += measureTextWidth(ctx, segment.text, font)
    })

    return totalWidth
}

module.exports = {
    drawInfoLine
}
