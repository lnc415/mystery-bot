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
    params: { count: 25, order: "desc" },
  });

  const raw = Array.isArray(res.data) ? res.data : [];

  // Only keep transactions from the last 60 minutes.
  // 10 minutes was too short — if the bot restarts mid-window or Replit
  // sleeps for a minute, trades would fall outside the window and be
  // permanently missed.  The in-memory seenTrades map (10-min TTL) prevents
  // re-alerting the same tx within the same session.
  const cutoff = Math.floor(Date.now() / 1000) - 3600;

  return raw
    .map((t) => ({
      txHash:    t.tx_hash || "",
      blockTime: t.block_time || Math.floor(Date.now() / 1000),
    }))
    .filter((t) => t.blockTime >= cutoff);
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

// ── Address-based classification ───────────────────────────────
//
// Cardano address prefixes:
//   addr1q... = user wallet (key-based)    → buyer/seller
//   addr1w... = script address (DEX/contract) → pool/order contract
//
// This approach tracks WHERE tokens actually land, not pool internals.
// Works across all Cardano DEX architectures (Minswap, SundaeSwap, etc.)
// including batched order models where pool UTXOs don't carry token amounts.

/**
 * Returns true if the address is a user wallet (not a script/DEX contract).
 * @param {string} address
 * @returns {boolean}
 */
function isUserAddress(address) {
  return typeof address === "string" && address.startsWith("addr1q");
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
 * Sum token quantity for our policy across a list of UTXOs.
 * @param {Array} utxos
 * @param {string} policyId
 * @returns {bigint}
 */
function sumTokens(utxos, policyId) {
  return utxos.reduce((sum, u) => {
    for (const a of u.amount || []) {
      if (a.unit !== "lovelace" && a.unit.startsWith(policyId)) {
        sum += BigInt(a.quantity || 0);
      }
    }
    return sum;
  }, 0n);
}

/**
 * Classify a transaction by tracking token and ADA flow.
 *
 * BUY:  token arrives at a user wallet (addr1q) in outputs.
 *       Works for direct swaps AND batched DEX models (Minswap etc.)
 *       because tokens always end up at the buyer's wallet.
 *
 * SELL: In batched models (Minswap), user pre-sends tokens to an order
 *       contract (addr1w), so no addr1q input has tokens. Instead we detect
 *       sells by: token is present in script inputs AND a user wallet
 *       receives significant ADA in outputs (what they got for selling).
 *       Also catches direct sells where token leaves from addr1q inputs.
 *
 * @param {object} utxos     - { inputs, outputs }
 * @param {string} policyId
 * @returns {'buy'|'sell'|'liquidity_add'|'liquidity_remove'|'other'}
 */
function classifyTransaction(utxos, policyId) {
  const inputs  = utxos.inputs  || [];
  const outputs = utxos.outputs || [];

  const hasToken = (u) =>
    (u.amount || []).some((a) => a.unit !== "lovelace" && a.unit.startsWith(policyId));

  const getLovelace = (u) => {
    const lv = (u.amount || []).find((a) => a.unit === "lovelace");
    return BigInt(lv?.quantity || 0);
  };

  // ── BUY: token lands at a user wallet ────────────────────────
  // Works for both direct swaps and batched execution (Minswap, SundaeSwap)
  const buyReceipts = outputs.filter((u) => isUserAddress(u.address) && hasToken(u));
  if (buyReceipts.length > 0) return "buy";

  // ── Check if token is involved at all ────────────────────────
  const tokenInvolved = [...inputs, ...outputs].some(hasToken);
  if (!tokenInvolved) return "other";

  // ── SELL: token involved but NOT landing at user wallet ───────
  // Batched sell model: user sent tokens to order contract earlier.
  // The execution TX shows tokens in script inputs + ADA going to user.
  const tokenInScriptInputs = inputs.some((u) => !isUserAddress(u.address) && hasToken(u));

  // User wallet receives more than 2 ADA (not just dust/change)
  const userReceivesAda = outputs.some(
    (u) => isUserAddress(u.address) && getLovelace(u) > 2_000_000n
  );

  if (tokenInScriptInputs && userReceivesAda) return "sell";

  // Direct sell: token leaves from user wallet input
  const directSell = inputs.some((u) => isUserAddress(u.address) && hasToken(u));
  if (directSell) return "sell";

  // ── Liquidity event: token moves between script addresses ─────
  const contractTokenIn  = inputs.filter( (u) => !isUserAddress(u.address) && hasToken(u));
  const contractTokenOut = outputs.filter((u) => !isUserAddress(u.address) && hasToken(u));

  if (contractTokenIn.length > 0 && contractTokenOut.length > 0) {
    const tokenIn  = sumTokens(contractTokenIn,  policyId);
    const tokenOut = sumTokens(contractTokenOut, policyId);
    if (tokenIn !== tokenOut) {
      return tokenOut > tokenIn ? "liquidity_add" : "liquidity_remove";
    }
  }

  return "other";
}

/**
 * Extract ADA amount spent/received by user wallets.
 * For buys:  net ADA out of user wallets (what they paid)
 * For sells: net ADA into user wallets (what they received)
 *
 * @param {object} utxos
 * @param {string} policyId
 * @returns {number} ADA amount
 */
function extractAdaAmount(utxos, policyId, action = "other") {
  const inputs  = utxos.inputs  || [];
  const outputs = utxos.outputs || [];

  const userInputs  = inputs.filter((u) => isUserAddress(u.address));
  const userOutputs = outputs.filter((u) => isUserAddress(u.address));

  const adaIn  = sumLovelace(userInputs);
  const adaOut = sumLovelace(userOutputs);

  if (action === "buy") {
    // For buys, show GROSS ADA the user sent — not net after the min-UTXO
    // returned with the tokens. E.g. user sends 5 ADA, gets back 1.67 ADA
    // locked with tokens; net would show 3.33 but the user spent 5 ADA.
    // If the user wallet has no inputs (batched fill tx), fall back to net.
    return adaIn > 0n ? Number(adaIn) / 1_000_000 : Number(adaOut) / 1_000_000;
  }

  // For sells and other: absolute net ADA change at user wallets
  const diff = adaIn > adaOut ? adaIn - adaOut : adaOut - adaIn;
  return Number(diff) / 1_000_000;
}

/**
 * Extract token amount received or sent by user wallets.
 *
 * @param {object} utxos
 * @param {string} policyId
 * @returns {number}
 */
function extractTokenAmount(utxos, policyId) {
  const inputs  = utxos.inputs  || [];
  const outputs = utxos.outputs || [];

  // Tokens received at user wallets (buy) or sent from user wallets (sell)
  const userOutputTokens = sumTokens(
    outputs.filter((u) => isUserAddress(u.address)), policyId
  );
  const userInputTokens = sumTokens(
    inputs.filter((u) => isUserAddress(u.address)), policyId
  );

  const diff = userOutputTokens > userInputTokens
    ? userOutputTokens - userInputTokens
    : userInputTokens  - userOutputTokens;

  return Number(diff);
}

/**
 * Get asset name hex for the first asset under a policy ID.
 * Used as fallback when Koios is unavailable.
 * Extracts the asset name by stripping the policy ID from the full asset unit.
 *
 * @param {string} policyId
 * @param {string} apiKey
 * @returns {Promise<string>} hex asset name (e.g. "4e49474854") or ""
 */
async function getAssetNameHex(policyId, apiKey) {
  const client = makeClient(apiKey);
  const res    = await client.get(`/assets/policy/${policyId}`, {
    params: { count: 1, order: "desc" },
  });

  const assets = Array.isArray(res.data) ? res.data : [];
  if (assets.length === 0) return "";

  // Full asset unit = policyId + assetNameHex
  // Strip the policy ID prefix to get just the asset name hex
  const fullUnit = assets[0].asset || "";
  return fullUnit.slice(policyId.length);
}

module.exports = {
  getAssetTransactions,
  getTransactionDetails,
  classifyTransaction,
  extractAdaAmount,
  extractTokenAmount,
  buildAssetUnit,
  getAssetNameHex,
};
