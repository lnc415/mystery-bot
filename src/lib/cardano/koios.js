/**
 * Koios API Wrapper
 * ─────────────────────────────────────────────────────────────────
 * Free, open-source Cardano API — no API key required.
 * Replaces Taptools as a free alternative for trade data.
 * API base: https://api.koios.rest/api/v1
 * Docs: https://api.koios.rest
 * ─────────────────────────────────────────────────────────────────
 */

const axios = require("axios");

const BASE_URL = "https://api.koios.rest/api/v1";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 12_000,
  headers: { "Accept": "application/json" },
});

/**
 * Get recent transactions for a policy ID.
 * Koios returns raw on-chain tx data — we classify direction heuristically.
 *
 * @param {string} policyId
 * @returns {Promise<Array<{ action, adaAmount, tokenAmount, txHash, time, dex }>>}
 */
async function getRecentTrades(policyId) {
  // Fetch recent transactions for this policy
  const res = await client.post("/asset_txs", {
    _asset_list: [[policyId, ""]],
    _after_block_height: 0,
  });

  const txs = Array.isArray(res.data) ? res.data.slice(0, 20) : [];
  if (txs.length === 0) return [];

  // Fetch UTXOs for each tx to classify buy/sell
  const trades = [];

  for (const tx of txs) {
    const txHash = tx.tx_hash;
    if (!txHash) continue;

    try {
      const utxoRes = await client.get(`/tx_utxos?_tx_hashes=["${txHash}"]`);
      const utxoData = Array.isArray(utxoRes.data) ? utxoRes.data[0] : null;
      if (!utxoData) continue;

      const inputs  = utxoData.inputs  || [];
      const outputs = utxoData.outputs || [];

      // Determine ADA flow to classify buy vs sell
      // Buy:  ADA goes OUT of user wallet, token comes IN → net ADA negative
      // Sell: Token goes OUT, ADA comes IN → net ADA positive
      let adaIn  = 0;
      let adaOut = 0;

      for (const inp of inputs) {
        const lovelace = inp.value?.find(v => v.unit === "lovelace");
        if (lovelace) adaIn += Number(lovelace.quantity || 0);
      }
      for (const out of outputs) {
        const lovelace = out.value?.find(v => v.unit === "lovelace");
        if (lovelace) adaOut += Number(lovelace.quantity || 0);
      }

      const netAda     = (adaOut - adaIn) / 1_000_000; // lovelace → ADA
      const adaAmount  = Math.abs(netAda);
      const action     = netAda > 0 ? "buy" : "sell"; // ADA out = user bought token

      // Find token amount from outputs
      let tokenAmount = 0;
      for (const out of outputs) {
        const tok = out.value?.find(v => v.unit.startsWith(policyId));
        if (tok) tokenAmount += Number(tok.quantity || 0);
      }

      trades.push({
        action,
        adaAmount,
        tokenAmount,
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

module.exports = { getRecentTrades };
