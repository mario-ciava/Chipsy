const clamp = (value, min, max) => {
    if (!Number.isFinite(value)) return min
    if (Number.isFinite(min) && value < min) return min
    if (Number.isFinite(max) && value > max) return max
    return value
}

const pickRandomCard = (deck) => {
    if (!Array.isArray(deck) || deck.length === 0) return null
    const index = Math.floor(Math.random() * deck.length)
    const [card] = deck.splice(index, 1)
    return card || null
}

const dealRandomCards = (deck, count) => {
    if (!Array.isArray(deck) || deck.length === 0 || !Number.isFinite(count) || count <= 0) {
        return []
    }
    const cards = []
    for (let i = 0; i < count; i++) {
        const card = pickRandomCard(deck)
        if (!card) break
        cards.push(card)
    }
    return cards
}

const yieldEventLoop = async () => new Promise((resolve) => setImmediate(resolve))

module.exports = {
    clamp,
    pickRandomCard,
    dealRandomCards,
    yieldEventLoop
}
