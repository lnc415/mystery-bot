/**
 * TapTools source — purpose-built Cardano token analytics API.
 * Better for token-specific monitoring than raw Blockfrost.
 * https://taptools.io — requires API key
 *
 * Also covers Midnight Network tokens when available.
 */

const axios  = require("axios");
const config = require("../../../config");

const tt = axios.create({
  baseURL: "https://openapi.taptools.io/api/v1",
  headers: { "x-api-key": config.chain.tapToolsKey },
  timeout: 10000,
});

/**
 * Get recent trades for a token.
 * Returns array of trade objects: { type, ada, tokens, time, txHash }
 */
async function getRecentTrades(limit = 20) {
  const unit = config.chain.policyId + Buffer.from(config.chain.tokenName).toString("hex");
  const res = await tt.get(`/token/trades`, {
    params: { unit, limit, order: "desc" },
  });
  return res.data || [];
}

/**
 * Get token price and market data.
 */
async function getTokenStats() {
  const unit = config.chain.policyId + Buffer.from(config.chain.tokenName).toString("hex");
  const res = await tt.get(`/token/prices`, { params: { unit } });
  return res.data?.[0] || null;
}

/**
 * Get liquidity pool events.
 */
async function getLiquidityEvents(limit = 10) {
  const unit = config.chain.policyId + Buffer.from(config.chain.tokenName).toString("hex");
  const res = await tt.get(`/token/liquidity`, { params: { unit, limit } });
  return res.data || [];
}

/**
 * Classify a TapTools trade object.
 * TapTools already provides type: "buy" | "sell"
 */
function classifyTrade(trade) {
  return trade.type || "other";
}

module.exports = { getRecentTrades, getTokenStats, getLiquidityEvents, classifyTrade };
