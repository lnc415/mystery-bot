/**
 * Blockfrost source — polls Cardano transactions for a token.
 * Supports mainnet, preprod, preview, and Midnight (via config).
 * https://blockfrost.io — free tier: 50k requests/day
 */

const axios  = require("axios");
const config = require("../../../config");

const NETWORK_URLS = {
  mainnet: "https://cardano-mainnet.blockfrost.io/api/v0",
  preprod: "https://cardano-preprod.blockfrost.io/api/v0",
  preview: "https://cardano-preview.blockfrost.io/api/v0",
  // Midnight uses its own Blockfrost-compatible endpoint
  midnight: "https://cardano-midnight.blockfrost.io/api/v0",
};

const BASE_URL = NETWORK_URLS[config.chain.blockfrostNet] || NETWORK_URLS.mainnet;

const bf = axios.create({
  baseURL: BASE_URL,
  headers: { project_id: config.chain.blockfrostId },
  timeout: 10000,
});

/**
 * Fetch latest transactions for a token (by policy ID + name).
 * Returns an array of raw tx objects.
 */
async function getRecentTxs(page = 1) {
  const assetId = config.chain.policyId + Buffer.from(config.chain.tokenName).toString("hex");
  const res = await bf.get(`/assets/${assetId}/transactions`, {
    params: { count: 20, page, order: "desc" },
  });
  return res.data;
}

/**
 * Fetch full transaction UTXO detail.
 */
async function getTxDetail(txHash) {
  const [utxos, meta] = await Promise.all([
    bf.get(`/txs/${txHash}/utxos`),
    bf.get(`/txs/${txHash}`),
  ]);
  return { utxos: utxos.data, meta: meta.data };
}

/**
 * Classify a transaction as: buy | sell | liquidity_add | liquidity_remove | other
 * Based on ADA and token flow relative to known DEX pool addresses.
 *
 * Simple heuristic:
 *  - ADA in, token out  → buy
 *  - Token in, ADA out  → sell
 *  - Both in            → liquidity add
 *  - Both out           → liquidity remove
 */
function classifyTx(utxos, policyId) {
  let adaIn = 0n, adaOut = 0n;
  let tokenIn = 0n, tokenOut = 0n;

  for (const input of utxos.inputs || []) {
    adaIn += BigInt(input.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
    for (const amt of input.amount || []) {
      if (amt.unit.startsWith(policyId)) tokenIn += BigInt(amt.quantity);
    }
  }

  for (const output of utxos.outputs || []) {
    adaOut += BigInt(output.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
    for (const amt of output.amount || []) {
      if (amt.unit.startsWith(policyId)) tokenOut += BigInt(amt.quantity);
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
 * Extract ADA amount moved (in ADA, not lovelace).
 */
function extractAda(utxos) {
  const total = (utxos.inputs || []).reduce((sum, inp) => {
    return sum + BigInt(inp.amount?.find((a) => a.unit === "lovelace")?.quantity || 0);
  }, 0n);
  return Number(total) / 1_000_000;
}

module.exports = { getRecentTxs, getTxDetail, classifyTx, extractAda };
