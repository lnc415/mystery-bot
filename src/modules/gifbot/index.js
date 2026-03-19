/**
 * GIF Bot Module
 * ─────────────────────────────────────────────────────────────────
 * Responds to /gif with a random image from (in priority order):
 *   1. Google Drive folder  (if configured via /setup gifbot drive:URL)
 *   2. Local folder         (assets/gifs/ or ./gifs/)
 *   3. Built-in defaults    (hardcoded fallback GIF URLs)
 *
 * Free tier — no license required.
 * Drive config is read from guilds.json via guildConfig.
 * ─────────────────────────────────────────────────────────────────
 */

const {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require("discord.js");
const fs   = require("fs");
const path = require("path");

const { getRandomImage } = require("../../lib/imageSources");

function sourceLabel(source) {
  if (source === "drive") return "Google Drive";
  if (source === "local") return "Local Folder";
  return "Built-in";
}

// ── Slash command definition ───────────────────────────────────

const command = new SlashCommandBuilder()
  .setName("gif")
  .setDescription("Drop a random detective GIF");

// ── Slash command handler ──────────────────────────────────────

async function execute(interaction) {
  await interaction.deferReply();

  try {
    const guildId = interaction.guildId;
    const image   = await getRandomImage(guildId);
    const footer  = `From: ${sourceLabel(image.source)} • Mystery Bot`;

    if (image.source === "local") {
      const attachment = new AttachmentBuilder(image.url);
      const embed = new EmbedBuilder()
        .setImage(`attachment://${path.basename(image.url)}`)
        .setFooter({ text: footer });
      await interaction.editReply({ files: [attachment], embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setImage(image.url)
        .setFooter({ text: footer });
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("[GifBot]", err.message);
    await interaction.editReply(
      "Couldn't find a GIF right now. Try again or ask an admin to check the config."
    );
  }
}

// ── Register (event-based fallback for legacy index.js loader) ─

function register(client) {
  console.log("[GifBot] Active — command: /gif");
  // Slash command interactions are handled by index.js commandHandlers dispatch.
  // Nothing needed here for the SaaS model.
}

module.exports = { register, command, execute };
