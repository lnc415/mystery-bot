/**
 * /debug — Admin-only live diagnostic command
 * ─────────────────────────────────────────────────────────────────
 * Tests the FULL pipeline from guild config → channel fetch → test post.
 * Removes the need to read Replit logs just to know why alerts aren't firing.
 *
 * /debug config   — show raw guild config (modules, policyId, channelIds)
 * /debug post     — actually try to send a test embed to the buybot channel
 * /debug monitor  — show monitoring state (active guilds, Blockfrost key, etc.)
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { getGuildConfig, getModuleConfig, hasModule, getActiveMonitoringGuilds } = require("../lib/guildConfig");
const koios      = require("../lib/cardano/koios");
const blockfrost = require("../lib/cardano/blockfrost");
const BLOCKFROST_KEY = process.env.BLOCKFROST_API_KEY || process.env.BLOCKFROST_PROJECT_ID || "";

// ── /debug config ──────────────────────────────────────────────

async function handleConfig(interaction) {
  const guildId = interaction.guildId;
  const guild   = getGuildConfig(guildId);

  const modules  = (guild.modules || []).join(", ") || "none";
  const cfg      = guild.config || {};

  const buybot    = cfg.buybot    || {};
  const sellbot   = cfg.sellbot   || {};
  const liquidity = cfg.liquidity || {};
  const gifbot    = cfg.gifbot    || {};

  const lines = [
    `**Guild ID:** \`${guildId}\``,
    `**Modules:** ${modules}`,
    `**License key:** ${guild.licenseKey || "none"}`,
    `**Expires:** ${guild.expiresAt || "n/a"}`,
    ``,
    `**BuyBot**`,
    `  Policy: \`${buybot.policyId || "❌ NOT SET"}\``,
    `  Channel: \`${buybot.channelId || "❌ NOT SET"}\``,
    `  Ticker: ${buybot.ticker || "❌ NOT SET"}`,
    ``,
    `**SellBot**`,
    `  Policy: \`${sellbot.policyId || "❌ NOT SET"}\``,
    `  Channel: \`${sellbot.channelId || "❌ NOT SET"}\``,
    `  Ticker: ${sellbot.ticker || "❌ NOT SET"}`,
    ``,
    `**Liquidity**`,
    `  Policy: \`${liquidity.policyId || "❌ NOT SET"}\``,
    `  Channel: \`${liquidity.channelId || "❌ NOT SET"}\``,
    ``,
    `**GifBot**`,
    `  Drive: ${gifbot.driveUrl ? "✅ configured" : "using built-in GIFs"}`,
  ];

  return interaction.reply({
    content: lines.join("\n"),
    ephemeral: true,
  });
}

// ── /debug post ────────────────────────────────────────────────

async function handlePost(interaction) {
  const guildId = interaction.guildId;
  await interaction.deferReply({ ephemeral: true });

  const cfg = getModuleConfig(guildId, "buybot");
  const results = [];

  // Step 1: check module licensed
  const licensed = hasModule(guildId, "buybot");
  results.push(`${licensed ? "✅" : "❌"} BuyBot licensed: **${licensed}**`);

  // Step 2: check channelId
  if (!cfg.channelId) {
    results.push(`❌ No channelId set in buybot config — run \`/setup buybot\``);
    return interaction.editReply(results.join("\n"));
  }
  results.push(`✅ Channel ID in config: \`${cfg.channelId}\``);

  // Step 3: try to fetch the channel
  let ch;
  try {
    ch = await interaction.client.channels.fetch(cfg.channelId);
    results.push(`✅ Channel fetched: **#${ch.name}** (type: ${ch.type})`);
  } catch (err) {
    results.push(`❌ Channel fetch failed: ${err.message}`);
    results.push(`   → Bot may not be in that server or lacks channel access`);
    return interaction.editReply(results.join("\n"));
  }

  // Step 4: try to send a test embed
  try {
    const testEmbed = new EmbedBuilder()
      .setColor(0x00c853)
      .setTitle("🧪 TEST — Buy Alert Pipeline")
      .setDescription("This is a diagnostic test message from `/debug post`. If you can see this, the full alert pipeline is working correctly.")
      .addFields(
        { name: "Guild",   value: guildId,       inline: true },
        { name: "Channel", value: `<#${cfg.channelId}>`, inline: true },
        { name: "Policy",  value: `\`${(cfg.policyId || "not set").slice(0, 16)}…\``, inline: false },
      )
      .setTimestamp();

    await ch.send({ embeds: [testEmbed] });
    results.push(`✅ **Test embed sent to <#${cfg.channelId}> successfully!**`);
    results.push(`   If you see it there → pipeline works, issue is in trade detection`);
    results.push(`   If you don't see it → bot lacks Send Messages permission`);
  } catch (err) {
    results.push(`❌ Send failed: **${err.message}**`);
    if (err.code) results.push(`   Discord error code: ${err.code}`);
    results.push(`   → Check bot has Send Messages + Embed Links permissions in that channel`);
  }

  return interaction.editReply(results.join("\n"));
}

// ── /debug monitor ─────────────────────────────────────────────

async function handleMonitor(interaction) {
  const activeGuilds = getActiveMonitoringGuilds();
  const bfKey = process.env.BLOCKFROST_API_KEY || process.env.BLOCKFROST_PROJECT_ID || "";

  const lines = [
    `**Blockfrost key:** ${bfKey ? `✅ set (${bfKey.slice(0, 8)}…)` : "❌ MISSING — Blockfrost disabled"}`,
    `**Active guilds:** ${activeGuilds.length}`,
    ...activeGuilds.map((gid) => {
      const buy = getModuleConfig(gid, "buybot");
      const sell = getModuleConfig(gid, "sellbot");
      return [
        ``,
        `**Guild \`${gid}\`**`,
        `  BuyBot policy: \`${buy.policyId?.slice(0, 16) || "not set"}…\``,
        `  BuyBot channel: \`${buy.channelId || "not set"}\``,
        `  SellBot channel: \`${sell.channelId || "not set"}\``,
      ].join("\n");
    }),
  ];

  if (activeGuilds.length === 0) {
    lines.push(``, `⚠️ No active guilds — run \`/license\` then \`/setup buybot\` to configure.`);
  }

  return interaction.reply({ content: lines.join("\n"), ephemeral: true });
}

// ── /debug trades ──────────────────────────────────────────────

async function handleTrades(interaction) {
  const guildId = interaction.guildId;
  await interaction.deferReply({ ephemeral: true });

  const cfg      = getModuleConfig(guildId, "buybot");
  const policyId = cfg.policyId;

  if (!policyId) {
    return interaction.editReply("❌ No policyId set — run `/setup buybot` first.");
  }

  const lines = [`**Policy:** \`${policyId.slice(0, 16)}…\``, ``];

  // Step 1: resolve asset name hex via Koios
  let assetNameHex = "";
  try {
    assetNameHex = await koios.getAssetNameHex(policyId);
    lines.push(`✅ Koios asset name hex: \`${assetNameHex || "(empty)"}\``);
  } catch (err) {
    lines.push(`❌ Koios getAssetNameHex failed: ${err.message}`);
  }

  // Step 2: fetch raw tx list from Koios
  try {
    const txs = await koios.getAssetTxs(policyId, assetNameHex, 5);
    lines.push(`✅ Koios getAssetTxs: **${txs.length}** txs returned`);
    if (txs.length > 0) {
      const latest = txs[0];
      const age = latest.block_time
        ? Math.round((Date.now() / 1000 - latest.block_time) / 60) + " min ago"
        : "unknown age";
      lines.push(`   Latest: \`${(latest.tx_hash || "").slice(0, 16)}…\` (${age})`);
    }
  } catch (err) {
    lines.push(`❌ Koios getAssetTxs failed: ${err.message}`);
  }

  lines.push(``);

  // Step 3: fetch from Blockfrost
  if (!BLOCKFROST_KEY) {
    lines.push(`❌ Blockfrost key not set — skipping`);
  } else {
    try {
      const assetUnit = policyId + (assetNameHex || "");
      lines.push(`**Blockfrost asset unit:** \`${assetUnit.slice(0, 20)}…\``);

      const rawTxs = await blockfrost.getAssetTransactions(policyId, assetNameHex, BLOCKFROST_KEY);
      lines.push(`✅ Blockfrost transactions: **${rawTxs.length}** returned (60-min window)`);

      if (rawTxs.length === 0) {
        lines.push(`   ⚠️ Zero txs — either no trades in last 60 min, or wrong asset unit`);
      } else {
        // Classify the first 3
        let shown = 0;
        for (const tx of rawTxs.slice(0, 3)) {
          try {
            const utxos  = await blockfrost.getTransactionDetails(tx.txHash, BLOCKFROST_KEY);
            const action = blockfrost.classifyTransaction(utxos, policyId);
            const ada    = blockfrost.extractAdaAmount(utxos, policyId);
            const age    = Math.round((Date.now() / 1000 - tx.blockTime) / 60);
            lines.push(`   \`${tx.txHash.slice(0, 12)}…\` → **${action}** ₳${ada.toFixed(1)} (${age}m ago)`);
            shown++;
          } catch (err) {
            lines.push(`   \`${tx.txHash.slice(0, 12)}…\` → classify error: ${err.message}`);
          }
        }
      }
    } catch (err) {
      lines.push(`❌ Blockfrost failed: ${err.message}`);
    }
  }

  return interaction.editReply(lines.join("\n"));
}

// ── Command definition ─────────────────────────────────────────

const command = new SlashCommandBuilder()
  .setName("debug")
  .setDescription("Admin diagnostic tools — check config, test alert posting")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("config").setDescription("Show raw guild config from guilds.json")
  )
  .addSubcommand((sub) =>
    sub.setName("post").setDescription("Send a test embed to the buybot channel right now")
  )
  .addSubcommand((sub) =>
    sub.setName("monitor").setDescription("Show monitoring state — active guilds, Blockfrost key")
  )
  .addSubcommand((sub) =>
    sub.setName("trades").setDescription("Live API test — fetch & classify recent trades right now")
  );

// ── Dispatcher ─────────────────────────────────────────────────

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case "config":  return handleConfig(interaction);
    case "post":    return handlePost(interaction);
    case "monitor": return handleMonitor(interaction);
    case "trades":  return handleTrades(interaction);
    default: return interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

module.exports = { command, execute };
