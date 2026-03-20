/**
 * Product catalog — single source of truth for pricing, modules, and copy.
 * Used by checkout.js (web handler) and keygen.js (key generator).
 */

module.exports = {
  buybot: {
    name: "Buy Bot",
    modules: ["buybot"],
    priceCents: 2500,
    days: 90,
    description: "Real-time buy alerts posted to your Discord channel every time someone buys your token",
  },
  sellbot: {
    name: "Sell Bot",
    modules: ["sellbot"],
    priceCents: 2500,
    days: 90,
    description: "Real-time sell alerts posted to your Discord channel every time someone sells your token",
  },
  bundle: {
    name: "Buy + Sell Bundle",
    modules: ["buybot", "sellbot"],
    priceCents: 4000,
    days: 90,
    description: "Both Buy Bot and Sell Bot together, save $10",
  },
};
