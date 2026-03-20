/**
 * Koios API Wrapper
 * ─────────────────────────────────────────────────────────────────
 * Free, open-source Cardano API — no API key required.
 * API base: https://api.koios.rest/api/v1
 * Docs: https://api.koios.rest
 *
 * Two-step approach:
 *   1. GET /policy_asset_list → get asset name hex for the policy
 *   2. GET /asset_txs         → get recent transactions
 *   3. POST /tx_utxos         → classify each tx as buy/sell
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const BASE_URL = "https://api.koios.rest/api/v1";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { "Accept": "application/json" },
});

// ── Step 1: Get asset name hex for a policy ────────────────────

/**
 * Get the hex asset name for the first asset under a policy ID.
 * Returns empty string if the token has no asset name.
 * @param {string} policyId
 * @returns {Promise<string>} asset name hex (e.g. "4e49474854")
 */
async function getAssetNameHex(policyId) {
  const res = await client.get("/policy_asset_list", {
    params: { _asset_policy: policyId },
  });

  const assets = Array.isArray(res.data) ? res.data : [];
  if (assets.length === 0) return "";

  // Return the asset_name of the first (usually only) asset
  return assets[0].asset_name || "";
}

// ── Step 2: Get recent transactions ───────────────────────────

/**
 * Get the most recent transactions for a token (policy + asset name).
 * @param {string} policyId
 * @param {string} assetNameHex
 * @param {number} limit
 * @returns {Promise<Array<{ tx_hash, block_time }>>}
 */
async function getAssetTxs(policyId, assetNameHex, limit = 20) {
  const params = {
    _asset_policy: policyId,
    limit,
  };

  // Only pass _asset_name if there's actually a name to filter on
  if (assetNameHex) params._asset_name = assetNameHex;

  const res = await client.get("/asset_txs", { params });
  return Array.isArray(res.data) ? res.data.slice(0, limit) : [];
}

// ── Step 3: Classify tx as buy/sell via UTXO data ─────────────

/**
 * Fetch UTXO details for a tx and classify as buy/sell.
 * @param {string} txHash
 * @param {string} policyId
 * @returns {Promise<{ action, adaAmount, tokenAmount }|null>}
 */
async function classifyTx(txHash, policyId) {
  const res = await client.post("/tx_utxos", {
    _tx_hashes: [txHash],
  });

  const utxoData = Array.isArray(res.data) ? res.data[0] : null;
  if (!utxoData) return null;

  const inputs  = utxoData.inputs  || [];
  const outputs = utxoData.outputs || [];

  // Sum ADA on inputs vs outputs to determine direction
  let adaIn  = 0;
  let adaOut = 0;
  let tokenOut = 0;

  for (const inp of inputs) {
    for (const v of (inp.value || [])) {
      if (v.unit === "lovelace") adaIn += Number(v.quantity || 0);
    }
  }

  for (const out of outputs) {
    for (const v of (out.value || [])) {
      if (v.unit === "lovelace") adaOut += Number(v.quantity || 0);
      // Token amounts on outputs (buyer receiving tokens)
      if (v.unit && v.unit.startsWith(policyId) && v.unit !== "lovelace") {
        tokenOut += Number(v.quantity || 0);
      }
    }
  }

  const netAda    = (adaOut - adaIn) / 1_000_000;
  const adaAmount = Math.abs(netAda);
  const action    = netAda > 0 ? "buy" : "sell";

  return { action, adaAmount, tokenAmount: tokenOut };
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get recent trades for a token policy, classified as buy/sell.
 * Automatically resolves the asset name hex from the policy ID.
 *
 * @param {string} policyId
 * @returns {Promise<Array<{ action, adaAmount, tokenAmount, txHash, time, dex }>>}
 */
async function getRecentTrades(policyId) {
  // Step 1: Resolve asset name hex
  const assetNameHex = await getAssetNameHex(policyId);

  // Step 2: Get recent transactions
  const txs = await getAssetTxs(policyId, assetNameHex, 20);
  if (txs.length === 0) return [];

  // Step 3: Classify each tx
  const trades = [];

  for (const tx of txs) {
    const txHash = tx.tx_hash;
    if (!txHash) continue;

    try {
      const classified = await classifyTx(txHash, policyId);
      if (!classified) continue;

      trades.push({
        action:      classified.action,
        adaAmount:   classified.adaAmount,
        tokenAmount: classified.tokenAmount,
        txHash,
        time: tx.block_time || Math.floor(Date.now() / 1000),
        dex:  "Cardano (Koios)",
      });
    } catch {
      // Skip individual TX errors silently
    }
  }

  return trades;
}

module.exports = { getRecentTrades, getAssetNameHex };
