/**
 * Buy / Sell / Liquidity Monitor Module
 * ─────────────────────────────────────────────────────────────────
 * Polls the configured chain source (Blockfrost or TapTools) on an
 * interval and posts formatted Discord alerts for:
 *   • Buys   (ENABLE_BUYBOT)
 *   • Sells  (ENABLE_SELLBOT)
 *   • Liquidity adds / removes  (ENABLE_LIQUIDITY)
 *
 * Works with Cardano mainnet, preprod, preview, and Midnight Network.
 * ─────────────────────────────────────────────────────────────────
 */

const { EmbedBuilder } = require("discord.js");
const config           = require("../../config");

// Track seen tx hashes so we don't double-alert
const seen = new Set();

// ── Embed builders ─────────────────────────────────────────────

function buyEmbed(data) {
  return new EmbedBuilder()
    .setColor(0x00d4ff)
    .setTitle(`🟢 ${config.chain.ticker} BUY DETECTED`)
    .addFields(
      { name: "ADA Spent",    value: `₳ ${data.ada.toFixed(2)}`, inline: true },
      { name: "Tokens",       value: `${Number(data.tokens).toLocaleString()} ${config.chain.ticker}`, inline: true },
      { name: "Network",      value: config.chain.blockfrostNet.toUpperCase(), inline: true }
    )
    .setFooter({ text: `TX: ${data.txHash.slice(0, 16)}…` })
    .setTimestamp();
}

function sellEmbed(data) {
  return new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle(`🔴 ${config.chain.ticker} SELL DETECTED`)
    .addFields(
      { name: "ADA Received", value: `₳ ${data.ada.toFixed(2)}`, inline: true },
      { name: "Tokens Sold",  value: `${Number(data.tokens).toLocaleString()} ${config.chain.ticker}`, inline: true },
      { name: "Network",      value: config.chain.blockfrostNet.toUpperCase(), inline: true }
    )
    .setFooter({ text: `TX: ${data.txHash.slice(0, 16)}…` })
    .setTimestamp();
}

function liquidityEmbed(data) {
  const isAdd = data.type === "liquidity_add";
  return new EmbedBuilder()
    .setColor(isAdd ? 0xc9a84c : 0x7c3aed)
    .setTitle(isAdd ? `💧 Liquidity Added — ${config.chain.ticker}` : `🚰 Liquidity Removed — ${config.chain.ticker}`)
    .addFields(
      { name: "ADA",     value: `₳ ${data.ada.toFixed(2)}`, inline: true },
      { name: "Tokens",  value: `${Number(data.tokens).toLocaleString()} ${config.chain.ticker}`, inline: true },
      { name: "Network", value: config.chain.blockfrostNet.toUpperCase(), inline: true }
    )
    .setFooter({ text: `TX: ${data.txHash.slice(0, 16)}…` })
    .setTimestamp();
}

// ── Blockfrost polling ─────────────────────────────────────────

async function pollBlockfrost(client) {
  const bf = require("./sources/blockfrost");

  try {
    const txs = await bf.getRecentTxs();

    for (const tx of txs) {
      if (seen.has(tx.tx_hash)) continue;
      seen.add(tx.tx_hash);
      if (seen.size > 500) {
        // Prevent unbounded growth
        const oldest = seen.values().next().value;
        seen.delete(oldest);
      }

      const { utxos } = await bf.getTxDetail(tx.tx_hash);
      const type = bf.classifyTx(utxos, config.chain.policyId);
      const ada  = bf.extractAda(utxos);

      if (ada < config.chain.buyMinAda) continue;

      // Token quantity (rough)
      const tokens = 0; // Blockfrost: derive from UTXO diff if needed

      const data = { txHash: tx.tx_hash, ada, tokens, type };

      if (type === "buy"  && config.modules.buybot)    await sendAlert(client, config.chain.buyChannel,       buyEmbed(data));
      if (type === "sell" && config.modules.sellbot)   await sendAlert(client, config.chain.sellChannel,      sellEmbed(data));
      if ((type === "liquidity_add" || type === "liquidity_remove") && config.modules.liquidity)
        await sendAlert(client, config.chain.liquidityChannel, liquidityEmbed(data));
    }
  } catch (err) {
    console.error("[BuyBot/Blockfrost]", err.message);
  }
}

// ── TapTools polling ───────────────────────────────────────────

async function pollTapTools(client) {
  const tt = require("./sources/taptools");

  try {
    const [trades, liquidity] = await Promise.all([
      tt.getRecentTrades(),
      config.modules.liquidity ? tt.getLiquidityEvents() : Promise.resolve([]),
    ]);

    for (const trade of trades) {
      const txHash = trade.txHash || trade.hash || "unknown";
      if (seen.has(txHash)) continue;
      seen.add(txHash);

      const type = tt.classifyTrade(trade);
      const ada  = Number(trade.adaValue || trade.ada || 0);
      const tokens = Number(trade.tokenAmount || trade.tokens || 0);

      if (ada < config.chain.buyMinAda) continue;

      const data = { txHash, ada, tokens, type };

      if (type === "buy"  && config.modules.buybot)  await sendAlert(client, config.chain.buyChannel,  buyEmbed(data));
      if (type === "sell" && config.modules.sellbot) await sendAlert(client, config.chain.sellChannel, sellEmbed(data));
    }

    for (const event of liquidity) {
      const txHash = event.txHash || event.hash || "unknown";
      if (seen.has(txHash)) continue;
      seen.add(txHash);

      const type = event.type || "liquidity_add";
      const ada  = Number(event.adaValue || 0);
      const tokens = Number(event.tokenAmount || 0);
      const data = { txHash, ada, tokens, type };

      await sendAlert(client, config.chain.liquidityChannel, liquidityEmbed(data));
    }
  } catch (err) {
    console.error("[BuyBot/TapTools]", err.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────

async function sendAlert(client, channelId, embed) {
  if (!channelId) return;
  try {
    const ch = await client.channels.fetch(channelId);
    if (ch) await ch.send({ embeds: [embed] });
  } catch (err) {
    console.error("[BuyBot] Failed to send alert:", err.message);
  }
}

// ── Register ───────────────────────────────────────────────────

function register(client) {
  if (!config.modules.buybot && !config.modules.sellbot && !config.modules.liquidity) return;
  if (!config.chain.policyId) {
    console.warn("[BuyBot] TOKEN_POLICY_ID not set — skipping.");
    return;
  }

  const poll = config.chain.source === "taptools" ? pollTapTools : pollBlockfrost;
  const intervalMs = config.chain.pollInterval * 1000;

  console.log(`[BuyBot] Polling ${config.chain.source} every ${config.chain.pollInterval}s for ${config.chain.ticker}`);

  // Wait for client to be ready before first poll
  client.once("ready", () => {
    poll(client);
    setInterval(() => poll(client), intervalMs);
  });
}

module.exports = { register };
