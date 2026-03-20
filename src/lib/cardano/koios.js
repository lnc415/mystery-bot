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

  // A policy can have multiple assets (e.g. NIGHT, ToBurn, empty-name leftovers).
  // Pick the one with the highest total_supply — that's always the main token.
  // Filter to non-empty names first so we don't return a blank asset name.
  const named = assets.filter((a) => a.asset_name);
  const pool  = named.length > 0 ? named : assets;

  const main = pool.reduce((best, a) => {
    const s = BigInt(a.total_supply || "0");
    const b = BigInt(best.total_supply || "0");
    return s > b ? a : best;
  }, pool[0]);

  return main.asset_name || "";
}

// ── Step 2: Get recent transactions ───────────────────────────

/**
 * Get the most recent transactions for a token (policy + asset name).
 * @param {string} policyId
 * @param {string} assetNameHex
 * @param {number} limit
 * @returns {Promise<Array<{ tx_hash, block_time }>>}
 */
async function getAssetTxs(policyId, assetNameHex, limit = 25) {
  const params = {
    _asset_policy: policyId,
    limit,
  };

  // Only pass _asset_name if there's actually a name to filter on
  if (assetNameHex) params._asset_name = assetNameHex;

  // Return newest transactions first so our limit covers the most recent activity
  params.order = "block_height.desc";

  const res = await client.get("/asset_txs", { params });
  return Array.isArray(res.data) ? res.data.slice(0, limit) : [];
}

// ── Step 3: Classify tx as buy/sell via UTXO data ─────────────
//
// Koios /tx_utxos response shape (per UTXO entry):
//   payment_addr.bech32  — bech32 address string
//   value                — lovelace as a STRING (e.g. "5000000")
//   asset_list           — array of { policy_id, asset_name, quantity }
//
// We use the same address-based heuristic as Blockfrost:
//   BUY:  token appears at a user wallet (addr1q) in outputs
//   SELL: token in script inputs AND user wallet receives ADA in outputs
//
// This avoids the broken "sum all ADA" method which always returns "sell"
// because tx fees make total adaOut < adaIn for every Cardano transaction.

/**
 * Returns true if the address is a user wallet (not a script/DEX contract).
 * Cardano user wallets start with addr1q; script addresses start with addr1w.
 */
function isUserAddr(address) {
  return typeof address === "string" && address.startsWith("addr1q");
}

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

  // Helper: does this UTXO contain the monitored token?
  const hasToken = (u) =>
    (u.asset_list || []).some((a) => a.policy_id === policyId);

  // Helper: lovelace value (Koios stores it as a string)
  const getLv = (u) => Number(u.value || 0);

  // Helper: is this a user wallet address?
  const isUser = (u) => isUserAddr(u.payment_addr?.bech32);

  // ── BUY: token lands at a user wallet output ──────────────────
  const buyReceipts = outputs.filter((u) => isUser(u) && hasToken(u));
  if (buyReceipts.length > 0) {
    const userAdaIn  = inputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);
    const userAdaOut = outputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);

    let adaAmount;
    if (userAdaIn > 0) {
      // Direct swap: user wallet was an input — use gross ADA spent.
      adaAmount = userAdaIn / 1_000_000;
    } else {
      // Batched fill (Minswap etc.): user's order was already in a script
      // UTXO, so no user wallet input exists in the execution TX.
      // The most accurate proxy is the pool's ADA gain: the pool UTXO
      // (script address that ALSO holds the token) has more ADA out than in.
      const poolInputs  = inputs.filter((u) => !isUser(u) && hasToken(u));
      const poolOutputs = outputs.filter((u) => !isUser(u) && hasToken(u));
      const poolAdaIn   = poolInputs.reduce((s, u)  => s + getLv(u), 0);
      const poolAdaOut  = poolOutputs.reduce((s, u) => s + getLv(u), 0);
      const poolDelta   = poolAdaOut - poolAdaIn; // positive = pool gained ADA (buy)
      adaAmount = poolDelta > 0
        ? poolDelta / 1_000_000
        : Math.abs(userAdaOut) / 1_000_000; // last-resort fallback
    }

    // Token amount received by user wallets
    const tokenAmount = buyReceipts.reduce((s, u) =>
      s + (u.asset_list || [])
        .filter((a) => a.policy_id === policyId)
        .reduce((t, a) => t + Number(a.quantity || 0), 0),
    0);

    return { action: "buy", adaAmount, tokenAmount };
  }

  // ── Check if token is involved at all ─────────────────────────
  const tokenInvolved = [...inputs, ...outputs].some(hasToken);
  if (!tokenInvolved) return null;

  // ── SELL: token in script inputs + user receives ADA ──────────
  const tokenInScriptInputs = inputs.some((u) => !isUser(u) && hasToken(u));
  const userReceivesAda     = outputs.some((u) => isUser(u) && getLv(u) > 2_000_000);

  if (tokenInScriptInputs && userReceivesAda) {
    const userAdaIn  = inputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);
    const userAdaOut = outputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);
    const adaAmount  = Math.abs(userAdaOut - userAdaIn) / 1_000_000;
    return { action: "sell", adaAmount, tokenAmount: 0 };
  }

  // Direct sell: token leaves from user wallet input
  const directSell = inputs.some((u) => isUser(u) && hasToken(u));
  if (directSell) {
    const userAdaIn  = inputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);
    const userAdaOut = outputs.filter(isUser).reduce((s, u) => s + getLv(u), 0);
    const adaAmount  = Math.abs(userAdaOut - userAdaIn) / 1_000_000;
    return { action: "sell", adaAmount, tokenAmount: 0 };
  }

  return null;
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

  // Step 2: Get recent transactions (newest first, 90-min window matches seenTrades TTL)
  const txs = await getAssetTxs(policyId, assetNameHex, 20);
  if (txs.length === 0) return [];

  const cutoff = Math.floor(Date.now() / 1000) - 90 * 60; // 90 minutes ago
  const recentTxs = txs.filter((tx) => (tx.block_time || 0) >= cutoff);
  if (recentTxs.length === 0) return [];

  // Step 3: Classify each tx
  const trades = [];

  for (const tx of recentTxs) {
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

module.exports = { getRecentTrades, getAssetNameHex, getAssetTxs };
