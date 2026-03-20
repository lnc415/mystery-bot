/**
 * Blockfrost API Wrapper
 * ─────────────────────────────────────────────────────────────────
 * Fallback source — watches raw on-chain transactions for a policy ID.
 * API base: https://cardano-mainnet.blockfrost.io/api/v0
 * Get your free project ID at: blockfrost.io (50k req/day free)
 *
 * Classification uses pool-UTXO method:
 *   • Find the UTXO(s) containing the token (these are the pool UTXOs)
 *   • If pool ADA INCREASED between input→output → BUY (buyer paid ADA)
 *   • If pool ADA DECREASED between input→output → SELL (seller got ADA)
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const BASE_URL = "https://cardano-mainnet.blockfrost.io/api/v0";

function makeClient(apiKey) {
  return axios.create({
    baseURL: BASE_URL,
    headers: { project_id: apiKey },
    timeout: 12_000,
  });
}

// ── Asset unit helper ──────────────────────────────────────────

/**
 * Build the Blockfrost asset unit from policy ID + asset name hex.
 * Blockfrost requires the full concatenated unit, not just the policy ID.
 * @param {string} policyId
 * @param {string} assetNameHex  - hex-encoded asset name (may be "")
 * @returns {string}
 */
function buildAssetUnit(policyId, assetNameHex) {
  return policyId + (assetNameHex || "");
}

// ── API calls ──────────────────────────────────────────────────

/**
 * Get recent transactions for a token asset unit.
 * @param {string} policyId      - Cardano policy ID (hex)
 * @param {string} assetNameHex  - hex asset name (from Koios lookup)
 * @param {string} apiKey        - Blockfrost project_id
 * @returns {Promise<Array<{ txHash, blockTime }>>}
 */
async function getAssetTransactions(policyId, assetNameHex, apiKey) {
  const client    = makeClient(apiKey);
  const assetUnit = buildAssetUnit(policyId, assetNameHex);

  const res = await client.get(`/assets/${assetUnit}/transactions`, {
    params: { count: 10, order: "desc" },
  });

  const raw = Array.isArray(res.data) ? res.data : [];
  return raw.map((t) => ({
    txHash:    t.tx_hash || "",
    blockTime: t.block_time || Math.floor(Date.now() / 1000),
  }));
}

/**
 * Get full UTXO details for a transaction.
 * @param {string} txHash
 * @param {string} apiKey
 * @returns {Promise<{ inputs, outputs }>}
 */
async function getTransactionDetails(txHash, apiKey) {
  const client = makeClient(apiKey);
  const res    = await client.get(`/txs/${txHash}/utxos`);
  return {
    inputs:  res.data?.inputs  || [],
    outputs: res.data?.outputs || [],
  };
}

// ── Pool-based classification ──────────────────────────────────

/**
 * Find UTXOs that contain the tracked token (pool UTXOs).
 * @param {Array} utxos
 * @param {string} policyId
 * @returns {Array}
 */
function findPoolUtxos(utxos, policyId) {
  return utxos.filter((u) =>
    (u.amount || []).some(
      (a) => a.unit !== "lovelace" && a.unit.startsWith(policyId)
    )
  );
}

/**
 * Sum lovelace across a list of UTXOs.
 * @param {Array} utxos
 * @returns {bigint}
 */
function sumLovelace(utxos) {
  return utxos.reduce((sum, u) => {
    const lv = (u.amount || []).find((a) => a.unit === "lovelace");
    return sum + BigInt(lv?.quantity || 0);
  }, 0n);
}

/**
 * Classify a transaction using pool UTXO ADA flow.
 *
 * Logic:
 *   Pool UTXOs are those containing the tracked token.
 *   If pool ADA OUT > pool ADA IN → pool gained ADA → buyer spent ADA → BUY
 *   If pool ADA OUT < pool ADA IN → pool lost ADA  → seller received ADA → SELL
 *
 * @param {object} utxos     - { inputs, outputs }
 * @param {string} policyId
 * @returns {'buy'|'sell'|'liquidity_add'|'liquidity_remove'|'other'}
 */
function classifyTransaction(utxos, policyId) {
  const poolInputs  = findPoolUtxos(utxos.inputs  || [], policyId);
  const poolOutputs = findPoolUtxos(utxos.outputs || [], policyId);

  // No pool UTXOs found — unrelated tx
  if (poolInputs.length === 0 && poolOutputs.length === 0) return "other";

  const poolAdaIn  = sumLovelace(poolInputs);
  const poolAdaOut = sumLovelace(poolOutputs);

  // Track token amounts in pool UTXOs
  let tokenIn  = 0n;
  let tokenOut = 0n;

  for (const u of poolInputs) {
    for (const a of u.amount || []) {
      if (a.unit !== "lovelace" && a.unit.startsWith(policyId)) {
        tokenIn += BigInt(a.quantity || 0);
      }
    }
  }
  for (const u of poolOutputs) {
    for (const a of u.amount || []) {
      if (a.unit !== "lovelace" && a.unit.startsWith(policyId)) {
        tokenOut += BigInt(a.quantity || 0);
      }
    }
  }

  const adaDiff   = poolAdaOut - poolAdaIn;   // + means pool gained ADA (buy)
  const tokenDiff = tokenOut   - tokenIn;     // + means pool gained tokens (sell)

  if (adaDiff > 0n && tokenDiff < 0n) return "buy";
  if (adaDiff < 0n && tokenDiff > 0n) return "sell";
  if (adaDiff > 0n && tokenDiff > 0n) return "liquidity_add";
  if (adaDiff < 0n && tokenDiff < 0n) return "liquidity_remove";
  return "other";
}

/**
 * Extract trade ADA amount (the pool's ADA change, i.e., what the buyer paid).
 * @param {object} utxos
 * @param {string} policyId
 * @returns {number} ADA amount
 */
function extractAdaAmount(utxos, policyId) {
  const poolInputs  = findPoolUtxos(utxos.inputs  || [], policyId);
  const poolOutputs = findPoolUtxos(utxos.outputs || [], policyId);

  const poolAdaIn  = sumLovelace(poolInputs);
  const poolAdaOut = sumLovelace(poolOutputs);

  // Return absolute difference → how much ADA changed hands
  const diff = poolAdaOut > poolAdaIn
    ? poolAdaOut - poolAdaIn
    : poolAdaIn  - poolAdaOut;

  return Number(diff) / 1_000_000;
}

/**
 * Extract token amount moved for a given policy from pool UTXOs.
 * @param {object} utxos
 * @param {string} policyId
 * @returns {number}
 */
function extractTokenAmount(utxos, policyId) {
  const poolInputs  = findPoolUtxos(utxos.inputs  || [], policyId);
  const poolOutputs = findPoolUtxos(utxos.outputs || [], policyId);

  let tokenIn  = 0n;
  let tokenOut = 0n;

  for (const u of poolInputs) {
    for (const a of u.amount || []) {
      if (a.unit !== "lovelace" && a.unit.startsWith(policyId)) {
        tokenIn += BigInt(a.quantity || 0);
      }
    }
  }
  for (const u of poolOutputs) {
    for (const a of u.amount || []) {
      if (a.unit !== "lovelace" && a.unit.startsWith(policyId)) {
        tokenOut += BigInt(a.quantity || 0);
      }
    }
  }

  const diff = tokenIn > tokenOut ? tokenIn - tokenOut : tokenOut - tokenIn;
  return Number(diff);
}

module.exports = {
  getAssetTransactions,
  getTransactionDetails,
  classifyTransaction,
  extractAdaAmount,
  extractTokenAmount,
  buildAssetUnit,
};
