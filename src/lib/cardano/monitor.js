/**
 * Cardano DEX Monitor — Core Polling Engine
 * ─────────────────────────────────────────────────────────────────
 * Polls two API sources per guild on a 30-second interval:
 *   1. Koios      (primary  — free, no key required)
 *   2. Blockfrost (fallback — raw on-chain, requires key)
 *
 * Both sources run in parallel and results are merged + deduplicated
 * by txHash so no trade is missed even if one API is slow.
 *
 * Posts Discord embeds to configured channels for:
 *   • Buys      (🟢 green, buybot module)
 *   • Sells     (🔴 red,   sellbot module)
 *   • Liquidity (💧 blue,  liquidity module)
 *
 * API keys are stored server-side — customers never need their own.
 * ─────────────────────────────────────────────────────────────────
 */

const { EmbedBuilder } = require("discord.js");
const koios      = require("./koios");
const blockfrost = require("./blockfrost");
const guildConfig = require("../guildConfig");

// ── Deduplication store ────────────────────────────────────────
// Map<guildId, Set<txHash>> — prevents the same trade from alerting twice.
const seenTrades = new Map();

const MAX_SEEN = 500; // cap per guild to prevent unbounded memory growth

// ── Config ─────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "30000", 10);

// API keys — stored in Replit Secrets, never exposed to customers
// Koios is free and requires no key
const BLOCKFROST_API_KEY = process.env.BLOCKFROST_API_KEY || process.env.BLOCKFROST_PROJECT_ID || "";

// Cache for resolved asset name hex per policy — avoids re-fetching every tick
const assetNameCache = new Map();

// ── Helpers ────────────────────────────────────────────────────

/**
 * Format a number as ADA with commas and 2 decimal places.
 * @param {number} n
 * @returns {string}
 */
function formatAda(n) {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a token amount with commas, no decimals.
 * @param {number} n
 * @returns {string}
 */
function formatTokens(n) {
  return Math.round(Number(n)).toLocaleString("en-US");
}

/**
 * Show relative time: "just now", "2 minutes ago", "1 hour ago", etc.
 * @param {number} timestamp - Unix timestamp (seconds)
 * @returns {string}
 */
function relativeTime(timestamp) {
  const diffSec = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (diffSec < 60)  return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(diffSec / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Short TX hash for display: first 8 + "..." + last 8 chars.
 * @param {string} txHash
 * @returns {string}
 */
function shortHash(txHash) {
  if (!txHash || txHash.length < 16) return txHash || "unknown";
  return `${txHash.slice(0, 8)}...${txHash.slice(-8)}`;
}

/**
 * Add a txHash to the guild's seen set, evicting the oldest when over limit.
 * @param {string} guildId
 * @param {string} txHash
 */
function markSeen(guildId, txHash) {
  if (!seenTrades.has(guildId)) seenTrades.set(guildId, new Set());
  const set = seenTrades.get(guildId);
  if (set.size >= MAX_SEEN) {
    // Delete the oldest entry (first value in insertion order)
    set.delete(set.values().next().value);
  }
  set.add(txHash);
}

/**
 * Check if a txHash has already been alerted for a guild.
 * @param {string} guildId
 * @param {string} txHash
 * @returns {boolean}
 */
function hasSeen(guildId, txHash) {
  return seenTrades.has(guildId) && seenTrades.get(guildId).has(txHash);
}

// ── Trade fetching ─────────────────────────────────────────────

/**
 * Resolve and cache the asset name hex for a policy ID.
 * Tries Koios /policy_asset_list once per policy, then caches indefinitely.
 * @param {string} policyId
 * @returns {Promise<string>} hex asset name (may be "")
 */
async function resolveAssetNameHex(policyId) {
  if (assetNameCache.has(policyId)) return assetNameCache.get(policyId);
  try {
    const hex = await koios.getAssetNameHex(policyId);
    assetNameCache.set(policyId, hex);
    console.log(`[Monitor] Resolved asset name for ${policyId.slice(0,8)}…: "${hex}"`);
    return hex;
  } catch {
    assetNameCache.set(policyId, "");
    return "";
  }
}

/**
 * Fetch from Blockfrost and classify each tx.
 * @param {string} policyId
 * @param {string} assetNameHex
 * @returns {Promise<Array>}
 */
async function fetchBlockfrostTrades(policyId, assetNameHex) {
  if (!BLOCKFROST_API_KEY) return [];
  const rawTxs = await blockfrost.getAssetTransactions(policyId, assetNameHex, BLOCKFROST_API_KEY);
  const trades = [];

  for (const tx of rawTxs) {
    if (!tx.txHash) continue;
    try {
      const utxos       = await blockfrost.getTransactionDetails(tx.txHash, BLOCKFROST_API_KEY);
      const action      = blockfrost.classifyTransaction(utxos, policyId);
      if (action === "other") continue;
      const adaAmount   = blockfrost.extractAdaAmount(utxos, policyId);
      const tokenAmount = blockfrost.extractTokenAmount(utxos, policyId);
      trades.push({
        action,
        adaAmount,
        tokenAmount,
        txHash: tx.txHash,
        time:   tx.blockTime,
        dex:    "Cardano Chain",
        source: "Blockfrost",
      });
    } catch {
      // Skip individual TX errors silently
    }
  }
  return trades;
}

/**
 * Run Koios + Blockfrost in parallel, merge results, deduplicate by txHash.
 * Returns new, unseen trades with source + ticker tagged.
 *
 * @param {string} guildId
 * @returns {Promise<Array>}
 */
async function fetchNewTrades(guildId) {
  const buybotCfg    = guildConfig.getModuleConfig(guildId, "buybot");
  const sellbotCfg   = guildConfig.getModuleConfig(guildId, "sellbot");
  const liquidityCfg = guildConfig.getModuleConfig(guildId, "liquidity");

  const policyId = buybotCfg.policyId || sellbotCfg.policyId || liquidityCfg.policyId || "";
  const ticker   = buybotCfg.ticker   || sellbotCfg.ticker   || "$TOKEN";

  if (!policyId) return [];

  // Resolve asset name hex once (cached after first call)
  const assetNameHex = await resolveAssetNameHex(policyId);

  // ── Run Koios + Blockfrost in parallel ────────────────────────
  const [koiosTrades, blockfrostTrades] = await Promise.allSettled([
    koios.getRecentTrades(policyId),
    fetchBlockfrostTrades(policyId, assetNameHex),
  ]);

  const koiosResults      = koiosTrades.status      === "fulfilled" ? koiosTrades.value      : [];
  const blockfrostResults = blockfrostTrades.status === "fulfilled" ? blockfrostTrades.value : [];

  if (koiosTrades.status === "rejected") {
    console.warn(`[Monitor/${guildId}] Koios failed: ${koiosTrades.reason?.message}`);
  }
  if (blockfrostTrades.status === "rejected") {
    console.warn(`[Monitor/${guildId}] Blockfrost failed: ${blockfrostTrades.reason?.message}`);
  }

  // Tag Koios results with source
  const koiosTagged = koiosResults.map((t) => ({ ...t, source: "Koios" }));

  // Merge all trades — deduplicate by txHash across sources
  const allTrades = [...koiosTagged, ...blockfrostResults];
  const seenHashes = new Set();
  const merged = [];

  for (const trade of allTrades) {
    if (!trade.txHash || seenHashes.has(trade.txHash)) continue;
    seenHashes.add(trade.txHash);
    merged.push(trade);
  }

  console.log(`[Monitor/${guildId}] Poll: ${koiosTagged.length} Koios + ${blockfrostResults.length} Blockfrost = ${merged.length} unique trades`);

  // ── Deduplicate against already-alerted trades ────────────────
  const newTrades = [];

  for (const trade of merged) {
    if (hasSeen(guildId, trade.txHash)) continue;
    markSeen(guildId, trade.txHash);
    newTrades.push({ ...trade, ticker });
  }

  if (newTrades.length > 0) {
    console.log(`[Monitor/${guildId}] ${newTrades.length} new trade(s) to alert`);
  }

  return newTrades;
}

// ── Buy tier helpers ───────────────────────────────────────────

/**
 * Determine the buy tier based on ADA amount.
 * @param {number} adaAmount
 * @returns {{ name: string, emoji: string, key: string, threshold: string }}
 */
function getTier(adaAmount) {
  if (adaAmount < 200)  return { name: "Small",  emoji: "🐟", key: "small",  threshold: "< ₳200"    };
  if (adaAmount < 1000) return { name: "Medium", emoji: "🐬", key: "medium", threshold: "₳200–₳999" };
  return                       { name: "Whale",  emoji: "🐋", key: "whale",  threshold: "≥ ₳1,000"  };
}

// ── Discord embed builders ─────────────────────────────────────

/**
 * Build a green buy alert embed with optional tier image.
 * @param {object} trade
 * @param {{ name: string, emoji: string, key: string, threshold: string }} tier
 * @param {string|null} imageUrl  - tier image URL, or null if not configured
 * @returns {EmbedBuilder}
 */
function buildBuyEmbed(trade, tier, imageUrl) {
  const txLink     = `[${shortHash(trade.txHash)}](https://cardanoscan.io/transaction/${trade.txHash})`;
  const tierLabel  = tier.name === "Whale" ? `${tier.emoji} WHALE BUY` : `${tier.emoji} NEW BUY`;

  const embed = new EmbedBuilder()
    .setColor(0x00c853)
    .setTitle(`${tierLabel} — ${trade.ticker || "$TOKEN"}`)
    .addFields(
      { name: "📊 Tier",        value: `${tier.emoji} ${tier.name} (${tier.threshold})`, inline: true },
      { name: "💰 ADA Spent",   value: `₳ ${formatAda(trade.adaAmount)}`,               inline: true },
      { name: "🪙 Tokens Got",  value: `${formatTokens(trade.tokenAmount)} ${trade.ticker || ""}`, inline: true },
      { name: "🏪 DEX",         value: trade.dex || "Unknown",                           inline: true },
      { name: "🔗 TX",          value: txLink,                                           inline: false },
      { name: "⏰ Time",         value: relativeTime(trade.time),                         inline: true },
      { name: "📡 Source",       value: trade.source || "Unknown",                        inline: true },
    )
    .setTimestamp();

  if (imageUrl) embed.setImage(imageUrl);

  return embed;
}

/**
 * Build a red sell alert embed.
 * @param {object} trade
 * @returns {EmbedBuilder}
 */
function buildSellEmbed(trade) {
  const txLink = `[${shortHash(trade.txHash)}](https://cardanoscan.io/transaction/${trade.txHash})`;
  return new EmbedBuilder()
    .setColor(0xd50000)
    .setTitle(`🔴 SELL DETECTED — ${trade.ticker || "$TOKEN"}`)
    .addFields(
      { name: "💰 ADA Received", value: `₳ ${formatAda(trade.adaAmount)}`,      inline: true },
      { name: "🪙 Tokens Sold",  value: `${formatTokens(trade.tokenAmount)} ${trade.ticker || ""}`, inline: true },
      { name: "🏪 DEX",          value: trade.dex || "Unknown",                   inline: true },
      { name: "🔗 TX",           value: txLink,                                   inline: false },
      { name: "⏰ Time",          value: relativeTime(trade.time),                 inline: true },
      { name: "📡 Source",        value: trade.source || "Unknown",                inline: true },
    )
    .setTimestamp();
}

/**
 * Build a blue liquidity event embed.
 * @param {object} event
 * @returns {EmbedBuilder}
 */
function buildLiquidityEmbed(event) {
  const txLink    = `[${shortHash(event.txHash)}](https://cardanoscan.io/transaction/${event.txHash})`;
  const typeLabel = event.action === "liquidity_remove" ? "Remove Liquidity" : "Add Liquidity";
  return new EmbedBuilder()
    .setColor(0x1565c0)
    .setTitle(`💧 LIQUIDITY EVENT — ${event.ticker || "$TOKEN"}`)
    .addFields(
      { name: "📋 Type",         value: typeLabel,                                 inline: true },
      { name: "💰 ADA Amount",   value: `₳ ${formatAda(event.adaAmount)}`,        inline: true },
      { name: "🪙 Token Amount", value: `${formatTokens(event.tokenAmount)} ${event.ticker || ""}`, inline: true },
      { name: "🏪 Pool",         value: event.dex || "Unknown Pool",               inline: true },
      { name: "🔗 TX",           value: txLink,                                    inline: false },
      { name: "⏰ Time",          value: relativeTime(event.time),                  inline: true },
    )
    .setTimestamp();
}

// ── Alert senders ──────────────────────────────────────────────

/**
 * Post a buy alert embed to the guild's configured buybot channel.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {object} trade
 */
async function postBuyAlert(client, guildId, trade) {
  const cfg = guildConfig.getModuleConfig(guildId, "buybot");
  if (!cfg.channelId) return;
  try {
    const tier     = getTier(trade.adaAmount || 0);
    const imageUrl = cfg.tiers?.[tier.key]?.imageUrl || null;
    const ch = await client.channels.fetch(cfg.channelId);
    if (ch) await ch.send({ embeds: [buildBuyEmbed(trade, tier, imageUrl)] });
  } catch (err) {
    console.error(`[Monitor/${guildId}] Failed to post buy alert: ${err.message}`);
  }
}

/**
 * Post a sell alert embed to the guild's configured sellbot channel.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {object} trade
 */
async function postSellAlert(client, guildId, trade) {
  const cfg = guildConfig.getModuleConfig(guildId, "sellbot");
  if (!cfg.channelId) return;
  try {
    const ch = await client.channels.fetch(cfg.channelId);
    if (ch) await ch.send({ embeds: [buildSellEmbed(trade)] });
  } catch (err) {
    console.error(`[Monitor/${guildId}] Failed to post sell alert: ${err.message}`);
  }
}

/**
 * Post a liquidity event embed to the guild's configured liquidity channel.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {object} event
 */
async function postLiquidityAlert(client, guildId, event) {
  const cfg = guildConfig.getModuleConfig(guildId, "liquidity");
  if (!cfg.channelId) return;
  try {
    const ch = await client.channels.fetch(cfg.channelId);
    if (ch) await ch.send({ embeds: [buildLiquidityEmbed(event)] });
  } catch (err) {
    console.error(`[Monitor/${guildId}] Failed to post liquidity alert: ${err.message}`);
  }
}

// ── Polling tick ───────────────────────────────────────────────

/**
 * Run one polling tick: fetch all active monitoring guilds and
 * post alerts for any new trades/events found.
 *
 * @param {import('discord.js').Client} client
 */
async function tick(client) {
  const activeGuilds = guildConfig.getActiveMonitoringGuilds();

  for (const guildId of activeGuilds) {
    try {
      const newTrades = await fetchNewTrades(guildId);
      const hasBuybot    = guildConfig.hasModule(guildId, "buybot");
      const hasSellbot   = guildConfig.hasModule(guildId, "sellbot");
      const hasLiquidity = guildConfig.hasModule(guildId, "liquidity");

      for (const trade of newTrades) {
        if (trade.isLiquidity) {
          if (hasLiquidity) await postLiquidityAlert(client, guildId, trade);
        } else if (trade.action === "buy") {
          if (hasBuybot) await postBuyAlert(client, guildId, trade);
        } else if (trade.action === "sell") {
          if (hasSellbot) await postSellAlert(client, guildId, trade);
        }
      }
    } catch (err) {
      // Never crash the bot — just log and continue to next guild
      console.error(`[Monitor/${guildId}] Tick error: ${err.message}`);
    }
  }
}

// ── Entry point ────────────────────────────────────────────────

/**
 * Start the DEX monitoring polling engine.
 * Called once after the Discord client is ready.
 *
 * @param {import('discord.js').Client} client
 */
function startMonitoring(client) {
  console.log(`[Monitor] DEX monitor starting — polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Initial tick immediately, then on interval
  tick(client);
  setInterval(() => tick(client), POLL_INTERVAL_MS);
}

module.exports = {
  startMonitoring,
  fetchNewTrades,
  postBuyAlert,
  postSellAlert,
  postLiquidityAlert,
};
