/**
 * Blockfrost API Wrapper
 * ─────────────────────────────────────────────────────────────────
 * Fallback source — watches raw on-chain transactions for a policy ID.
 * API base: https://cardano-mainnet.blockfrost.io/api/v0
 * Get your free project ID at: blockfrost.io (50k req/day free)
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const BASE_URL = "https://cardano-mainnet.blockfrost.io/api/v0";

/**
 * Get recent transactions for a policy ID (asset).
 * Returns an array of { txHash, blockTime }.
 *
 * @param {string} policyId  - Cardano policy ID (hex)
 * @param {string} apiKey    - Blockfrost project_id
 * @returns {Promise<Array<{ txHash, blockTime }>>}
 */
async function getAssetTransactions(policyId, apiKey) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: { project_id: apiKey },
    timeout: 10_000,
  });

  const res = await client.get(`/assets/${policyId}/transactions`, {
    params: { count: 10, order: "desc" },
  });

  const raw = Array.isArray(res.data) ? res.data : [];

  return raw.map((t) => ({
    txHash:    t.tx_hash || t.txHash || "",
    blockTime: t.block_time || Math.floor(Date.now() / 1000),
  }));
}

/**
 * Get full UTXO details for a transaction.
 * Used to classify buy vs sell by inspecting ADA and token flow.
 *
 * @param {string} txHash  - Transaction hash
 * @param {string} apiKey  - Blockfrost project_id
 * @returns {Promise<{ inputs: Array, outputs: Array }>}
 */
async function getTransactionDetails(txHash, apiKey) {
  const client = axios.create({
    baseURL: BASE_URL,
    headers: { project_id: apiKey },
    timeout: 10_000,
  });

  const res = await client.get(`/txs/${txHash}/utxos`);
  return {
    inputs:  res.data?.inputs  || [],
    outputs: res.data?.outputs || [],
  };
}

/**
 * Classify a transaction by its UTXO structure.
 * Heuristic: ADA in + token out → buy; token in + ADA out → sell;
 *            both in → liquidity_add; both out → liquidity_remove.
 *
 * @param {object} utxos     - { inputs, outputs } from getTransactionDetails
 * @param {string} policyId  - Cardano policy ID to track
 * @returns {'buy'|'sell'|'liquidity_add'|'liquidity_remove'|'other'}
 */
function classifyTransaction(utxos, policyId) {
  let adaIn = 0n, adaOut = 0n;
  let tokenIn = 0n, tokenOut = 0n;

  for (const input of utxos.inputs || []) {
    adaIn += BigInt(input.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
    for (const amt of input.amount || []) {
      if (amt.unit.startsWith(policyId)) tokenIn += BigInt(amt.quantity || 0);
    }
  }

  for (const output of utxos.outputs || []) {
    adaOut += BigInt(output.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
    for (const amt of output.amount || []) {
      if (amt.unit.startsWith(policyId)) tokenOut += BigInt(amt.quantity || 0);
    }
  }

  const netAda   = adaOut - adaIn;
  const netToken = tokenOut - tokenIn;

  if (netAda > 0n && netToken < 0n) return "buy";
  if (netAda < 0n && netToken > 0n) return "sell";
  if (netAda > 0n && netToken > 0n) return "liquidity_add";
  if (netAda < 0n && netToken < 0n) return "liquidity_remove";
  return "other";
}

/**
 * Extract total ADA moved (as a number, not lovelace) from UTXOs.
 *
 * @param {object} utxos - { inputs, outputs } from getTransactionDetails
 * @returns {number} ADA amount
 */
function extractAdaAmount(utxos) {
  const totalLovelace = (utxos.inputs || []).reduce((sum, inp) => {
    return sum + BigInt(inp.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
  }, 0n);
  return Number(totalLovelace) / 1_000_000;
}

/**
 * Extract token amount moved for a given policy ID from UTXOs.
 *
 * @param {object} utxos     - { inputs, outputs }
 * @param {string} policyId  - Cardano policy ID
 * @returns {number} token amount (raw quantity)
 */
function extractTokenAmount(utxos, policyId) {
  let tokenOut = 0n;
  for (const output of utxos.outputs || []) {
    for (const amt of output.amount || []) {
      if (amt.unit.startsWith(policyId)) {
        tokenOut += BigInt(amt.quantity || 0);
      }
    }
  }
  return Number(tokenOut);
}

module.exports = { getAssetTransactions, getTransactionDetails, classifyTransaction, extractAdaAmount, extractTokenAmount };
