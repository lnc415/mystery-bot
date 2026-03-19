/**
 * /configure — Server setup overview
 * ─────────────────────────────────────────────────────────────────
 * Admin-only. Shows which modules are active (green) vs locked (🔒),
 * a config summary for each active module, and a "Get License" button
 * if any modules are still locked.
 *
 * No parameters. Use /setup <module> to configure individual modules.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

const { getGuildConfig, getModuleConfig, hasModule } = require("../lib/guildConfig");
const { getLicenseForGuild }                         = require("../license/manager");

const DASHBOARD_URL = process.env.DASHBOARD_URL || "https://mysterysbot.com/buy";

// All modules the bot supports, in display order
const ALL_MODULES = ["gifbot", "buybot", "sellbot", "gifbot_drive", "chatbot", "liquidity"];

const MODULE_INFO = {
  gifbot:    { label: "GIF Bot",            emoji: "🎬", price: "Free",  free: true  },
  buybot:    { label: "Buy Bot",            emoji: "📈", price: "$25",   free: false },
  sellbot:   { label: "Sell Alerts",        emoji: "📉", price: "$25",   free: false },
  chatbot:   { label: "Chatbot (AI)",       emoji: "🤖", price: "$50",   free: false },
  liquidity: { label: "Liquidity Monitor",  emoji: "💧", price: "$25",   free: false },
};

const DISPLAY_ORDER = ["gifbot", "buybot", "sellbot", "chatbot", "liquidity"];

const command = new SlashCommandBuilder()
  .setName("configure")
  .setDescription("View bot module status and configuration for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Only server admins can configure the bot.",
      ephemeral: true,
    });
  }

  const guildId = interaction.guildId;
  const license = getLicenseForGuild(guildId);

  // Build module status lines
  const moduleLines = DISPLAY_ORDER.map((mod) => {
    const info    = MODULE_INFO[mod];
    const active  = hasModule(guildId, mod);

    if (!active) {
      return `🔒 ${info.emoji} **${info.label}** — Locked (${info.price})`;
    }

    // Module is licensed — show config summary
    const cfg = getModuleConfig(guildId, mod);
    let detail = "";

    if (mod === "gifbot") {
      detail = cfg.driveUrl
        ? `Drive connected (${cfg.folderId ? "folder set" : "url saved"})`
        : "Built-in GIFs";
    } else if (mod === "buybot") {
      const policy  = cfg.policyId  ? `Policy: \`${cfg.policyId.slice(0, 8)}…\`` : "⚠️ No policy set";
      const channel = cfg.channelId ? `<#${cfg.channelId}>`                       : "⚠️ No channel set";
      const tiers   = cfg.tiers || {};
      const hasSmall  = !!tiers.small?.imageUrl;
      const hasMedium = !!tiers.medium?.imageUrl;
      const hasWhale  = !!tiers.whale?.imageUrl;
      let tierDetail;
      if (hasSmall && hasMedium && hasWhale) {
        tierDetail = "🐟🐬🐋 All tier images set";
      } else if (!hasSmall && !hasMedium && !hasWhale) {
        tierDetail = "No tier images set — use `/setup buytier`";
      } else {
        const smallStr  = hasSmall  ? "🐟✅" : "🐟❌";
        const mediumStr = hasMedium ? "🐬✅" : "🐬❌";
        const whaleStr  = hasWhale  ? "🐋✅" : "🐋❌";
        const missing   = [!hasSmall && "small", !hasMedium && "medium", !hasWhale && "whale"]
          .filter(Boolean).join(", ");
        tierDetail = `${smallStr} ${mediumStr} ${whaleStr} (use \`/setup buytier\` to add ${missing} image)`;
      }
      detail = `${policy} → ${channel}\n　　　　${tierDetail}`;
    } else if (mod === "sellbot") {
      detail = cfg.channelId ? `Alerts → <#${cfg.channelId}>` : "⚠️ No channel set";
    } else if (mod === "chatbot") {
      const name = cfg.name ? `"${cfg.name}"` : "⚠️ No name set";
      detail = cfg.personality ? `${name} — personality configured` : `${name} — ⚠️ No personality set`;
    } else if (mod === "liquidity") {
      detail = cfg.channelId ? `Alerts → <#${cfg.channelId}>` : "⚠️ No channel set";
    }

    return `🟢 ${info.emoji} **${info.label}** — ${detail}`;
  }).join("\n");

  // Check if any paid modules are still locked
  const anyLocked = DISPLAY_ORDER.some((mod) => !MODULE_INFO[mod].free && !hasModule(guildId, mod));

  const licenseStatus = license
    ? `✅ Active — \`${license.key}\``
    : "⚠️ No license — free tier only";

  const embed = new EmbedBuilder()
    .setColor(license ? 0xc9a84c : 0x5865f2)
    .setTitle("🕵️ Mystery Bot — Server Configuration")
    .setDescription(
      `**License:** ${licenseStatus}\n\n` +
      `Use \`/setup <module>\` to configure any active module.\n` +
      `Use \`/license key:<key>\` to activate a purchased license.\n` +
      `Use \`/status\` for a quick public overview.`
    )
    .addFields({
      name: "Module Status",
      value: moduleLines,
      inline: false,
    });

  if (anyLocked) {
    embed.addFields({
      name: "Unlock More Modules",
      value:
        "Purchase a license at the link below, then run `/license key:<your-key>` to activate.\n" +
        "One license covers your entire server — all members benefit instantly.",
      inline: false,
    });
  }

  embed
    .setFooter({ text: "Mystery Bot • only server admins see this" })
    .setTimestamp();

  const components = [];
  if (anyLocked) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Get License →")
          .setStyle(ButtonStyle.Link)
          .setURL(DASHBOARD_URL)
          .setEmoji("🛒")
      )
    );
  }

  return interaction.reply({ embeds: [embed], components, ephemeral: true });
}

module.exports = { command, execute };
