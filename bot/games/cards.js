const config = require("../../config");

const SUITS = Object.freeze([...config.cards.suits]);
const RANKS = Object.freeze([...config.cards.ranks]);

const STANDARD_DECK = Object.freeze(
    SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`))
);

module.exports = STANDARD_DECK;
