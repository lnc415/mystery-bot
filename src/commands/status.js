/**
 * /status — Public module status for this server
 * ─────────────────────────────────────────────────────────────────
 * Anyone can run this. Shows each module with a dot indicator:
 *   🟢 Active and fully configured
 *   🟡 Licensed but not yet configured
 *   ⚫ Locked (needs license)
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { hasModule, getModuleConfig }        = require("../lib/guildConfig");
const { getLicenseForGuild }                = require("../license/manager");

const DISPLAY_ORDER = ["gifbot", "buybot", "sellbot", "chatbot", "liquidity"];

const MODULE_INFO = {
  gifbot:    { label: "GIF Bot (free)", emoji: "🎬" },
  buybot:    { label: "Buy Bot",        emoji: "📈" },
  sellbot:   { label: "Sell Alerts",    emoji: "📉" },
  chatbot:   { label: "Chatbot (AI)",   emoji: "🤖" },
  liquidity: { label: "Liquidity",      emoji: "💧" },
};

/**
 * Returns true if the module's required config fields are present.
 */
function isConfigured(guildId, mod) {
  const cfg = getModuleConfig(guildId, mod);
  switch (mod) {
    case "gifbot":    return true; // always considered configured (built-in fallback)
    case "buybot":    return !!(cfg.policyId && cfg.channelId);
    case "sellbot":   return !!cfg.channelId;
    case "chatbot":   return !!(cfg.name && cfg.personality);
    case "liquidity": return !!cfg.channelId;
    default:          return false;
  }
}

const command = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show which bot modules are active for this server");

async function execute(interaction) {
  const guildId = interaction.guildId;
  const license = getLicenseForGuild(guildId);

  const lines = DISPLAY_ORDER.map((mod) => {
    const info   = MODULE_INFO[mod];
    const active = hasModule(guildId, mod);

    if (!active) {
      return `⚫ ${info.emoji} **${info.label}** — Locked`;
    }

    const configured = isConfigured(guildId, mod);
    const dot        = configured ? "🟢" : "🟡";
    const note       = configured ? "Active" : `Licensed — run \`/setup ${mod}\` to finish setup`;

    return `${dot} ${info.emoji} **${info.label}** — ${note}`;
  });

  const licenseStatus = license
    ? `✅ Active — expires ${license.expires ? `<t:${Math.floor(new Date(license.expires).getTime() / 1000)}:R>` : "never (lifetime)"}`
    : "Free tier — run `/license` to unlock paid modules";

  const embed = new EmbedBuilder()
    .setColor(0xc9a84c)
    .setTitle("🕵️ Mystery Bot — Module Status")
    .addFields(
      { name: "License",  value: licenseStatus, inline: false },
      { name: "Modules",  value: lines.join("\n"), inline: false },
      {
        name: "Legend",
        value: "🟢 Active & configured  🟡 Licensed but needs setup  ⚫ Locked (needs license)",
        inline: false,
      }
    )
    .setFooter({ text: "Mystery Bot • admins: use /configure to manage settings" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: false });
}

module.exports = { command, execute };
