/**
 * /help — List available bot commands
 * ─────────────────────────────────────────────────────────────────
 * Shows the full command list. Admin commands are listed but only
 * work for users with the Administrator permission.
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const command = new SlashCommandBuilder()
  .setName("help")
  .setDescription("List available bot commands");

async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(0x00d4ff)
    .setTitle("🕵️ Mystery Bot — Commands")
    .setDescription("Everything is configured through Discord — no files, no code.")
    .addFields(
      {
        name: "Anyone",
        value: [
          "`/gif` — Drop a random GIF (always free)",
          "`/status` — See which modules are active for this server",
          "`/help` — This message",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Server Admins",
        value: [
          "`/configure` — View module status and config summary",
          "`/license key:<key>` — Activate a purchased license key",
          "`/setup buybot policy:<id> channel:<channel>` — Configure Buy Bot",
          "`/setup sellbot channel:<channel>` — Configure Sell Alerts",
          "`/setup gifbot [drive:<url>]` — Connect a Google Drive folder",
          "`/setup chatbot name:<name> personality:<desc>` — Configure AI Chatbot",
          "`/setup liquidity channel:<channel>` — Configure Liquidity Monitor",
        ].join("\n"),
        inline: false,
      },
      {
        name: "Getting Started",
        value:
          "1. Run `/configure` to see what's active\n" +
          "2. Run `/license key:<your-key>` to unlock paid modules\n" +
          "3. Run `/setup <module>` to configure each module",
        inline: false,
      }
    )
    .setFooter({ text: "Mystery Bot • one bot, many servers" })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

module.exports = { command, execute };
