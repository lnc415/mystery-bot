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
// Map<guildId, Map<txHash, timestamp>> — prevents double-alerts.
// Stores when each hash was first seen so we can expire old entries.
const seenTrades = new Map();

const MAX_SEEN    = 500;
// TTL must exceed the Blockfrost lookback window (3600s / 60 min).
// If TTL < lookback, expired hashes re-enter as "new" on the next tick
// and flood the channel with old trades. 90 minutes gives a safe buffer.
const SEEN_TTL_MS = 90 * 60 * 1000; // 90 minutes

// ── Bootstrap tracker ──────────────────────────────────────────
// Tracks which guildId:policyId combos have completed their first
// silent drain. On the first tick for a new combo we mark all
// existing transactions as seen WITHOUT posting — so only trades
// that happen AFTER the bot is activated ever fire an alert.
// When the policy ID changes the key changes, triggering a new
// silent drain for the fresh policy.
const bootstrapped = new Set();

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
 * Add a txHash to the guild's seen map with current timestamp.
 * Expires entries older than SEEN_TTL_MS so reclassified txs can re-fire
 * after a bot restart or code fix.
 * @param {string} guildId
 * @param {string} txHash
 */
function markSeen(guildId, txHash) {
  if (!seenTrades.has(guildId)) seenTrades.set(guildId, new Map());
  const map = seenTrades.get(guildId);

  // Evict expired entries to keep memory bounded
  const now = Date.now();
  if (map.size >= MAX_SEEN) {
    for (const [hash, ts] of map) {
      if (now - ts > SEEN_TTL_MS) map.delete(hash);
      if (map.size < MAX_SEEN) break;
    }
    // If still over limit, delete oldest
    if (map.size >= MAX_SEEN) {
      map.delete(map.keys().next().value);
    }
  }

  map.set(txHash, now);
}

/**
 * Check if a txHash was seen recently (within SEEN_TTL_MS).
 * Returns false for old entries so fixed classification can re-fire them.
 * @param {string} guildId
 * @param {string} txHash
 * @returns {boolean}
 */
function hasSeen(guildId, txHash) {
  if (!seenTrades.has(guildId)) return false;
  const map = seenTrades.get(guildId);
  if (!map.has(txHash)) return false;
  // Expire old entries — allows re-firing after bot restart/code fix
  if (Date.now() - map.get(txHash) > SEEN_TTL_MS) {
    map.delete(txHash);
    return false;
  }
  return true;
}

// ── Trade fetching ─────────────────────────────────────────────

/**
 * Resolve and cache the asset name hex for a policy ID.
 * Tries Koios first, falls back to Blockfrost /assets/policy/{id}.
 * Only caches on success — failures retry next poll.
 * @param {string} policyId
 * @returns {Promise<string>} hex asset name (may be "" for unnamed tokens)
 */
async function resolveAssetNameHex(policyId) {
  if (assetNameCache.has(policyId)) return assetNameCache.get(policyId);

  // 1. Try Koios (free, no key)
  // Only cache and return if Koios gives us a non-empty hex — an empty
  // string means the policy exists but Koios couldn't resolve the name,
  // so we fall through to Blockfrost rather than caching a bad value.
  try {
    const hex = await koios.getAssetNameHex(policyId);
    if (hex) {
      assetNameCache.set(policyId, hex);
      console.log(`[Monitor] Asset name resolved via Koios for ${policyId.slice(0,8)}…: "${hex}"`);
      return hex;
    }
    console.warn(`[Monitor] Koios returned empty asset name for ${policyId.slice(0,8)}… — trying Blockfrost`);
  } catch {
    console.warn(`[Monitor] Koios asset name lookup failed — trying Blockfrost`);
  }

  // 2. Fallback to Blockfrost /assets/policy/{policyId}
  if (BLOCKFROST_API_KEY) {
    try {
      const hex = await blockfrost.getAssetNameHex(policyId, BLOCKFROST_API_KEY);
      assetNameCache.set(policyId, hex);
      console.log(`[Monitor] Asset name resolved via Blockfrost for ${policyId.slice(0,8)}…: "${hex}"`);
      return hex;
    } catch {
      console.warn(`[Monitor] Blockfrost asset name lookup also failed`);
    }
  }

  // Do NOT cache failures — retry next poll
  console.warn(`[Monitor] Could not resolve asset name for ${policyId.slice(0,8)}… — will retry next poll`);
  return "";
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
      const adaAmount   = blockfrost.extractAdaAmount(utxos, policyId, action);
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

  // Merge all trades — Blockfrost first so its address-based classification
  // wins over Koios when both sources find the same txHash.
  // Blockfrost classification is more reliable for Minswap batched DEX model.
  const allTrades = [...blockfrostResults, ...koiosTagged];
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
  console.log(`[Monitor/${guildId}] postBuyAlert — channelId=${cfg.channelId} txHash=${trade.txHash?.slice(0,16)}…`);
  if (!cfg.channelId) {
    console.warn(`[Monitor/${guildId}] postBuyAlert: no channelId in buybot config — alert skipped`);
    return;
  }
  try {
    const tier     = getTier(trade.adaAmount || 0);
    const imageUrl = cfg.tiers?.[tier.key]?.imageUrl || null;
    console.log(`[Monitor/${guildId}] Fetching channel ${cfg.channelId}…`);
    const ch = await client.channels.fetch(cfg.channelId);
    if (!ch) {
      console.warn(`[Monitor/${guildId}] Channel ${cfg.channelId} not found — bot may lack access`);
      return;
    }
    console.log(`[Monitor/${guildId}] Sending buy embed to #${ch.name}`);
    await ch.send({ embeds: [buildBuyEmbed(trade, tier, imageUrl)] });
    console.log(`[Monitor/${guildId}] ✅ Buy alert posted — ${trade.adaAmount?.toFixed(2)} ADA | ${trade.txHash?.slice(0,16)}…`);
  } catch (err) {
    console.error(`[Monitor/${guildId}] Failed to post buy alert: ${err.message}`, err.code || "");
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
  console.log(`[Monitor/${guildId}] postSellAlert — channelId=${cfg.channelId} txHash=${trade.txHash?.slice(0,16)}…`);
  if (!cfg.channelId) {
    console.warn(`[Monitor/${guildId}] postSellAlert: no channelId in sellbot config — alert skipped`);
    return;
  }
  try {
    console.log(`[Monitor/${guildId}] Fetching channel ${cfg.channelId}…`);
    const ch = await client.channels.fetch(cfg.channelId);
    if (!ch) {
      console.warn(`[Monitor/${guildId}] Channel ${cfg.channelId} not found — bot may lack access`);
      return;
    }
    console.log(`[Monitor/${guildId}] Sending sell embed to #${ch.name}`);
    await ch.send({ embeds: [buildSellEmbed(trade)] });
    console.log(`[Monitor/${guildId}] ✅ Sell alert posted — ${trade.adaAmount?.toFixed(2)} ADA | ${trade.txHash?.slice(0,16)}…`);
  } catch (err) {
    console.error(`[Monitor/${guildId}] Failed to post sell alert: ${err.message}`, err.code || "");
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
  console.log(`[Monitor] Tick — ${activeGuilds.length} active guild(s): [${activeGuilds.join(", ")}]`);

  for (const guildId of activeGuilds) {
    try {
      // Determine the current policy for this guild so we can detect changes.
      const buybotCfg = guildConfig.getModuleConfig(guildId, "buybot");
      const policyId  = buybotCfg.policyId || "";
      const bKey      = `${guildId}:${policyId}`;

      const newTrades = await fetchNewTrades(guildId);

      // ── Bootstrap (silent drain) ─────────────────────────────
      // First tick for this guildId:policyId pair — all fetched
      // transactions are already marked seen by fetchNewTrades, so
      // just swallow them and log. Alerts start on the NEXT tick.
      if (!bootstrapped.has(bKey)) {
        bootstrapped.add(bKey);
        console.log(`[Monitor/${guildId}] Bootstrap: silently drained ${newTrades.length} existing trade(s) for policy ${policyId.slice(0, 8)}… — live alerts active from next tick`);
        continue;
      }

      const hasBuybot    = guildConfig.hasModule(guildId, "buybot");
      const hasSellbot   = guildConfig.hasModule(guildId, "sellbot");
      const hasLiquidity = guildConfig.hasModule(guildId, "liquidity");

      for (const trade of newTrades) {
        const action = trade.action;
        console.log(`[Monitor/${guildId}] Routing: ${action} | ${trade.adaAmount?.toFixed(2)} ADA | hasBuybot=${hasBuybot} | hasSellbot=${hasSellbot} | hasLiquidity=${hasLiquidity}`);

        if (action === "liquidity_add" || action === "liquidity_remove") {
          if (hasLiquidity) await postLiquidityAlert(client, guildId, trade);
          else console.log(`[Monitor/${guildId}] Skipped liquidity — module not licensed`);
        } else if (action === "buy") {
          if (hasBuybot) await postBuyAlert(client, guildId, trade);
          else console.log(`[Monitor/${guildId}] Skipped buy — buybot not licensed`);
        } else if (action === "sell") {
          if (hasSellbot) await postSellAlert(client, guildId, trade);
          else console.log(`[Monitor/${guildId}] Skipped sell — sellbot not licensed`);
        } else {
          console.log(`[Monitor/${guildId}] Unknown action "${action}" — skipping`);
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
  console.log(`[Monitor] Blockfrost key: ${BLOCKFROST_API_KEY ? "✅ set" : "❌ MISSING — Blockfrost disabled"}`);

  const activeGuilds = guildConfig.getActiveMonitoringGuilds();
  if (activeGuilds.length === 0) {
    console.warn(`[Monitor] ⚠️  No active guilds found in guilds.json — no monitoring will run.`);
    console.warn(`[Monitor] ⚠️  If you just deployed, re-run /license and /setup buybot in your Discord server.`);
  } else {
    console.log(`[Monitor] Active guilds at startup: ${activeGuilds.length} → [${activeGuilds.join(", ")}]`);
  }

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
