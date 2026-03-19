/**
 * DexHunter API Wrapper
 * ─────────────────────────────────────────────────────────────────
 * Secondary source — aggregates swaps across multiple Cardano DEXes.
 * API base: https://api.dexhunter.io/api
 * Get your key at: dexhunter.io
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const BASE_URL = "https://api.dexhunter.io";

/**
 * Get recent swaps for a token policy ID.
 * Normalizes DexHunter's response format to match the shared trade schema.
 *
 * @param {string} policyId  - Cardano policy ID (hex)
 * @param {string} apiKey    - DexHunter API key
 * @returns {Promise<Array<{ action, adaAmount, tokenAmount, txHash, time, dex }>>}
 */
async function getRecentSwaps(policyId, apiKey) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      "X-Api-Key": apiKey,
    },
    timeout: 10_000,
  });

  const res = await client.get("/swap/history", {
    params: { policy_id: policyId, limit: 20 },
  });

  const raw = Array.isArray(res.data) ? res.data : (res.data?.swaps || res.data?.data || []);

  return raw.map((s) => {
    // DexHunter uses "type" or infers from token flow direction
    const rawType = s.type || s.action || s.side || "";
    let action = "buy";
    if (/sell/i.test(rawType)) action = "sell";
    else if (/buy/i.test(rawType)) action = "buy";

    return {
      action,
      adaAmount:   Number(s.adaAmount || s.ada_amount || s.adaValue || s.ada || 0),
      tokenAmount: Number(s.tokenAmount || s.token_amount || s.tokens || s.amount || 0),
      txHash:      s.txHash || s.tx_hash || s.hash || "",
      time:        s.time || s.timestamp || s.createdAt || Math.floor(Date.now() / 1000),
      dex:         s.dex || s.exchange || s.pool || "Unknown DEX",
    };
  });
}

module.exports = { getRecentSwaps };
