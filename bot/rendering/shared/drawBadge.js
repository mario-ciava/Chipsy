const { CONFIG, drawRoundedRect, drawText } = require("../core/cardRenderBase")

function drawBadge(ctx, text, {
    x,
    y,
    fill,
    textColor,
    fontSize,
    paddingX = 14,
    paddingY = 6,
    bold = true,
    opacity = 0.9
} = {}) {
    if (!text) return { width: 0, height: 0 }
    const font = `${bold ? "700" : "500"} ${fontSize}px "${CONFIG.fontFamily}"`
    ctx.save()
    ctx.font = font
    const textWidth = ctx.measureText(text).width
    const width = textWidth + paddingX * 2
    const height = fontSize + paddingY * 2
    const radius = height / 2

    ctx.fillStyle = fill
    ctx.globalAlpha = opacity
    drawRoundedRect(ctx, x, y, width, height, radius)
    ctx.fill()
    ctx.restore()

    drawText(ctx, text, {
        x: x + width / 2,
        y: y + height / 2,
        size: fontSize,
        color: textColor,
        align: "center",
        baseline: "middle",
        bold
    })

    return { width, height }
}

module.exports = {
    drawBadge
}
