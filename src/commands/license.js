/**
 * /license key:<value> — Activate a license for this server
 * ─────────────────────────────────────────────────────────────────
 * Admin-only. Validates the key, binds it to this guild ID, saves
 * the unlocked module list to guilds.json, and confirms in Discord.
 *
 * Customers never touch code or files — this is the only step needed
 * after purchasing a license.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const { activateLicense, FREE_MODULES }    = require("../license/manager");
const { setGuildConfig, getGuildConfig }   = require("../lib/guildConfig");

const MODULE_LABELS = {
  gifbot:    "🎬 GIF Bot (free)",
  chatbot:   "🤖 Chatbot (AI)",
  buybot:    "📈 Buy Bot",
  sellbot:   "📉 Sell Alerts",
  liquidity: "💧 Liquidity Monitor",
};

const command = new SlashCommandBuilder()
  .setName("license")
  .setDescription("Activate a Mystery Bot license for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((opt) =>
    opt
      .setName("key")
      .setDescription("Your license key (format: MBOT-XXXX-XXXX-XXXX-XXXX)")
      .setRequired(true)
  );

async function execute(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Only server admins can activate a license.",
      ephemeral: true,
    });
  }

  const key     = interaction.options.getString("key").trim().toUpperCase();
  const guildId = interaction.guildId;

  if (!key.startsWith("MBOT-")) {
    return interaction.reply({
      embeds: [errorEmbed("Invalid key format. Keys look like: `MBOT-XXXX-XXXX-XXXX-XXXX`")],
      ephemeral: true,
    });
  }

  // Validate and bind key to this guild (updates license/keys.json)
  const result = await activateLicense(key, guildId);

  if (!result.success) {
    return interaction.reply({
      embeds: [errorEmbed(result.reason)],
      ephemeral: true,
    });
  }

  // Merge new modules with any already-licensed modules for this guild
  // so activating a second key never wipes out a previous one.
  const existing        = getGuildConfig(guildId);
  const existingModules = existing.modules || [];
  const merged          = [...new Set([...FREE_MODULES, ...existingModules, ...result.modules])];

  setGuildConfig(guildId, {
    licenseKey: key,
    modules:    merged,
    expiresAt:  result.expires || null,
  });

  const unlockedList = result.modules
    .map((m) => MODULE_LABELS[m] || m)
    .join("\n") || "—";

  const expires = result.expires
    ? `Expires <t:${Math.floor(new Date(result.expires).getTime() / 1000)}:R>`
    : "Lifetime license";

  const embed = new EmbedBuilder()
    .setColor(0x00c851)
    .setTitle("✅ License Activated!")
    .setDescription(
      `Mystery Bot is now licensed for **${interaction.guild.name}**.\n` +
      `All server members can immediately use the unlocked features.`
    )
    .addFields(
      { name: "License Key",      value: `\`${key}\``,       inline: false },
      { name: "Unlocked Modules", value: unlockedList,        inline: true  },
      { name: "Validity",         value: expires,             inline: true  },
      {
        name: "Next Steps",
        value:
          "Run `/configure` to see your module status.\n" +
          "Run `/setup <module>` to configure each unlocked module.",
        inline: false,
      }
    )
    .setFooter({ text: "Mystery Bot • license bound to this server" })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

function errorEmbed(reason) {
  return new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("❌ License Activation Failed")
    .setDescription(reason)
    .addFields({
      name: "Need Help?",
      value:
        "• Copy the key exactly as shown in your confirmation email\n" +
        "• Keys look like: `MBOT-XXXX-XXXX-XXXX-XXXX`\n" +
        "• Each key is for one server — buy a new one for additional servers\n" +
        "• Contact support if you believe this is an error",
    })
    .setFooter({ text: "Mystery Bot" })
    .setTimestamp();
}

module.exports = { command, execute };
