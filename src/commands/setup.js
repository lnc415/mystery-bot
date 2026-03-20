/**
 * /setup <module> — Configure individual bot modules
 * ─────────────────────────────────────────────────────────────────
 * Admin-only. One parent command with subcommands for each module.
 * Each subcommand checks the guild's license before allowing config.
 * gifbot is always free and never requires a license check.
 *
 * Subcommands:
 *   /setup buybot  policy:<policy_id> channel:<channel>
 *   /setup sellbot channel:<channel>
 *   /setup gifbot  [drive:<url>]
 *   /setup chatbot name:<name> personality:<description>
 *   /setup liquidity channel:<channel>
 * ─────────────────────────────────────────────────────────────────
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { hasModule, setModuleConfig, getModuleConfig } = require("../lib/guildConfig");
const { testGoogleDriveFolder }                       = require("../lib/imageSources");
const { resolveImageUrl }                             = require("../lib/imageUrl");

// ── License guard ───────────────────────────────────────────────

function requiresLicense(interaction, module) {
  if (hasModule(interaction.guildId, module)) return false;
  interaction.reply({
    content:
      `🔒 **${module}** requires a license. Run \`/configure\` to see pricing and get a key.`,
    ephemeral: true,
  });
  return true;
}

// ── Subcommand handlers ─────────────────────────────────────────

async function handleBuybot(interaction) {
  if (requiresLicense(interaction, "buybot")) return;

  const policyId = interaction.options.getString("policy");
  const ticker   = interaction.options.getString("ticker") || "$TOKEN";
  const channel  = interaction.options.getChannel("channel");
  const guildId  = interaction.guildId;

  setModuleConfig(guildId, "buybot", {
    policyId,
    ticker,
    channelId: channel.id,
  });

  return interaction.reply({
    content:
      `✅ **Buy Bot configured!**\n` +
      `Token: **${ticker}**\n` +
      `Monitoring policy \`${policyId.slice(0, 16)}…\` → <#${channel.id}>\n\n` +
      `Buy alerts will post there whenever a transaction is detected.`,
    ephemeral: true,
  });
}

async function handleSellbot(interaction) {
  if (requiresLicense(interaction, "sellbot")) return;

  const policyId = interaction.options.getString("policy");
  const channel  = interaction.options.getChannel("channel");
  const guildId  = interaction.guildId;

  setModuleConfig(guildId, "sellbot", {
    policyId:  policyId,
    channelId: channel.id,
  });

  return interaction.reply({
    content:
      `✅ **Sell Alerts configured!**\n` +
      `Monitoring policy \`${policyId.slice(0, 16)}…\` → <#${channel.id}>\n\n` +
      `Sell alerts will post there whenever a sell is detected.`,
    ephemeral: true,
  });
}

async function handleGifbot(interaction) {
  // gifbot is always free — no license check needed
  const driveUrl = interaction.options.getString("drive");
  const guildId  = interaction.guildId;

  if (!driveUrl) {
    const current = getModuleConfig(guildId, "gifbot");
    if (current.driveUrl) {
      return interaction.reply({
        content:
          `Currently using your Google Drive folder.\n` +
          `Run \`/setup gifbot drive:<url>\` to change it, or leave it as-is.`,
        ephemeral: true,
      });
    }
    return interaction.reply({
      content:
        `Currently using built-in GIFs.\n\n` +
        `Point to your own folder with \`/setup gifbot drive:<google-drive-folder-url>\`\n\n` +
        `**How to share a Drive folder:**\n` +
        `1. Go to [Google Drive](https://drive.google.com) and create a folder\n` +
        `2. Add your GIFs/JPGs/PNGs\n` +
        `3. Right-click → Share → **Anyone with the link → Viewer**\n` +
        `4. Copy the link and run the command above`,
      ephemeral: true,
    });
  }

  // Validate the Drive folder before saving
  await interaction.deferReply({ ephemeral: true });

  const result = await testGoogleDriveFolder(driveUrl);

  if (!result.ok) {
    return interaction.editReply(
      `❌ Could not access that Google Drive folder.\n\n` +
      `**Reason:** ${result.error}\n\n` +
      `**Fix:** Right-click the folder → Share → **Anyone with the link → Viewer**, then try again.`
    );
  }

  // Extract folder ID and save
  const folderId = driveUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] || null;
  setModuleConfig(guildId, "gifbot", { driveUrl, folderId });

  return interaction.editReply(
    `✅ **GIF Bot** will use your Google Drive folder — **${result.fileCount}** image${result.fileCount === 1 ? "" : "s"} found.\n\n` +
    `Falls back to built-in GIFs automatically if Drive is unavailable.`
  );
}

async function handleChatbot(interaction) {
  if (requiresLicense(interaction, "chatbot")) return;

  const name        = interaction.options.getString("name");
  const personality = interaction.options.getString("personality");
  const guildId     = interaction.guildId;

  setModuleConfig(guildId, "chatbot", { name, personality });

  return interaction.reply({
    content:
      `✅ **Chatbot configured** as **"${name}"**\n` +
      `Personality: _${personality.slice(0, 120)}${personality.length > 120 ? "…" : ""}_`,
    ephemeral: true,
  });
}

// ── Tier display helpers ────────────────────────────────────────

const TIER_META = {
  small:  { label: "Small",  emoji: "🐟", threshold: "under ₳200"  },
  medium: { label: "Medium", emoji: "🐬", threshold: "₳200–₳999"   },
  whale:  { label: "Whale",  emoji: "🐋", threshold: "≥ ₳1,000"    },
};

async function handleBuyTier(interaction) {
  if (requiresLicense(interaction, "buybot")) return;

  const tierKey = interaction.options.getString("tier");   // "small" | "medium" | "whale"
  const rawUrl  = interaction.options.getString("image");
  const guildId = interaction.guildId;

  const meta = TIER_META[tierKey];
  if (!meta) {
    return interaction.reply({ content: "❌ Unknown tier.", ephemeral: true });
  }

  // Defer while we validate the URL (network request may take a moment)
  await interaction.deferReply({ ephemeral: true });

  const result = await resolveImageUrl(rawUrl);

  if (!result.ok) {
    return interaction.editReply(
      `❌ Could not reach that image URL. Make sure it's publicly accessible.\n**Reason:** ${result.error}`
    );
  }

  // Deep-merge: read existing tiers, update only this tier's imageUrl
  const existing = getModuleConfig(guildId, "buybot");
  const prevTiers = existing.tiers || {};
  setModuleConfig(guildId, "buybot", {
    tiers: {
      ...prevTiers,
      [tierKey]: { imageUrl: result.url },
    },
  });

  return interaction.editReply(
    `✅ **${meta.emoji} ${meta.label} tier** image set! ` +
    `This will show for buys ${meta.threshold}.`
  );
}

async function handleLiquidity(interaction) {
  if (requiresLicense(interaction, "liquidity")) return;

  const policyId = interaction.options.getString("policy");
  const channel  = interaction.options.getChannel("channel");
  const guildId  = interaction.guildId;

  setModuleConfig(guildId, "liquidity", {
    policyId:  policyId,
    channelId: channel.id,
  });

  return interaction.reply({
    content:
      `✅ **Liquidity Monitor configured!**\n` +
      `Monitoring policy \`${policyId.slice(0, 16)}…\` → <#${channel.id}>\n\n` +
      `Liquidity add/remove events will post there.`,
    ephemeral: true,
  });
}

// ── Command definition ──────────────────────────────────────────

const command = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure bot modules for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  // /setup buybot
  .addSubcommand((sub) =>
    sub
      .setName("buybot")
      .setDescription("Configure Buy Bot — set token policy ID and alert channel")
      .addStringOption((opt) =>
        opt
          .setName("policy")
          .setDescription("Cardano token policy ID to monitor")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("ticker")
          .setDescription("Token ticker symbol shown in alerts (e.g. $NIGHT, $141)")
          .setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Channel where buy alerts will be posted")
          .setRequired(true)
      )
  )

  // /setup buytier
  .addSubcommand((sub) =>
    sub
      .setName("buytier")
      .setDescription("Set a custom image for small/medium/whale buy alerts")
      .addStringOption((opt) =>
        opt
          .setName("tier")
          .setDescription("Which buy size tier to configure")
          .setRequired(true)
          .addChoices(
            { name: "🐟 Small  (under ₳200)", value: "small"  },
            { name: "🐬 Medium (₳200–₳999)",  value: "medium" },
            { name: "🐋 Whale  (₳1,000+)",    value: "whale"  }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName("image")
          .setDescription("Direct image URL or Google Drive file/folder link (GIF, PNG, JPG)")
          .setRequired(true)
      )
  )

  // /setup sellbot
  .addSubcommand((sub) =>
    sub
      .setName("sellbot")
      .setDescription("Configure Sell Alerts — set token policy ID and alert channel")
      .addStringOption((opt) =>
        opt
          .setName("policy")
          .setDescription("Cardano token policy ID to monitor for sells")
          .setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Channel where sell alerts will be posted")
          .setRequired(true)
      )
  )

  // /setup gifbot
  .addSubcommand((sub) =>
    sub
      .setName("gifbot")
      .setDescription("Configure GIF Bot — optionally connect a Google Drive folder (always free)")
      .addStringOption((opt) =>
        opt
          .setName("drive")
          .setDescription("Public Google Drive folder URL (leave blank to use built-in GIFs)")
          .setRequired(false)
      )
  )

  // /setup chatbot
  .addSubcommand((sub) =>
    sub
      .setName("chatbot")
      .setDescription("Configure Chatbot — set name and personality")
      .addStringOption((opt) =>
        opt
          .setName("name")
          .setDescription("What the bot calls itself in responses (e.g. TradingBot)")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("personality")
          .setDescription("System prompt / personality (e.g. You are a helpful crypto trading assistant)")
          .setRequired(true)
      )
  )

  // /setup liquidity
  .addSubcommand((sub) =>
    sub
      .setName("liquidity")
      .setDescription("Configure Liquidity Monitor — set token policy ID and alert channel")
      .addStringOption((opt) =>
        opt
          .setName("policy")
          .setDescription("Cardano token policy ID to monitor for liquidity events")
          .setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Channel where liquidity alerts will be posted")
          .setRequired(true)
      )
  );

// ── Dispatcher ──────────────────────────────────────────────────

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Only server admins can configure the bot.",
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case "buybot":    return handleBuybot(interaction);
    case "buytier":   return handleBuyTier(interaction);
    case "sellbot":   return handleSellbot(interaction);
    case "gifbot":    return handleGifbot(interaction);
    case "chatbot":   return handleChatbot(interaction);
    case "liquidity": return handleLiquidity(interaction);
    default:
      return interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

module.exports = { command, execute };
