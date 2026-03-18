/**
 * GIF Bot Module
 * ─────────────────────────────────────────────────────────────────
 * Responds to /gif with a random GIF from:
 *   • local folder  (GIF_SOURCE=local, GIF_PATH=./gifs)
 *   • URL list file (GIF_SOURCE=url,   GIF_PATH=./gifs/urls.txt)
 *
 * Free tier — no license required.
 * ─────────────────────────────────────────────────────────────────
 */

const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const fs     = require("fs");
const path   = require("path");
const config = require("../../config");

const GIF_EXTENSIONS = [".gif", ".mp4", ".webm"];

function getAllowedChannels() {
  if (config.gif.channels === "all") return null; // null = all channels allowed
  return config.gif.channels.split(",").map((s) => s.trim());
}

function pickLocalGif() {
  const gifDir = path.resolve(config.gif.path);

  if (!fs.existsSync(gifDir)) {
    throw new Error(`GIF directory not found: ${gifDir}`);
  }

  const files = fs.readdirSync(gifDir).filter((f) =>
    GIF_EXTENSIONS.includes(path.extname(f).toLowerCase())
  );

  if (!files.length) throw new Error("No GIFs found in directory.");

  const chosen = files[Math.floor(Math.random() * files.length)];
  return path.join(gifDir, chosen);
}

function pickUrlGif() {
  const urlsFile = path.resolve(config.gif.path);

  if (!fs.existsSync(urlsFile)) {
    throw new Error(`URL list not found: ${urlsFile}`);
  }

  const urls = fs.readFileSync(urlsFile, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (!urls.length) throw new Error("No URLs in list.");

  return urls[Math.floor(Math.random() * urls.length)];
}

// ── Slash command definition ───────────────────────────────────

const command = new SlashCommandBuilder()
  .setName(config.gif.command)
  .setDescription("Drop a random detective GIF");

// ── Register ───────────────────────────────────────────────────

function register(client) {
  console.log(`[GifBot] Active — source: ${config.gif.source}, command: /${config.gif.command}`);

  const allowedChannels = getAllowedChannels();

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== config.gif.command) return;

    // Channel filter
    if (allowedChannels && !allowedChannels.includes(interaction.channelId)) {
      return interaction.reply({ content: "GIFs aren't allowed in this channel.", ephemeral: true });
    }

    await interaction.deferReply();

    try {
      if (config.gif.source === "url") {
        const url = pickUrlGif();
        await interaction.editReply(url);
      } else {
        const filePath = pickLocalGif();
        const attachment = new AttachmentBuilder(filePath);
        await interaction.editReply({ files: [attachment] });
      }
    } catch (err) {
      console.error("[GifBot]", err.message);
      await interaction.editReply("Couldn't find a GIF. Check the GIF_PATH config.");
    }
  });
}

module.exports = { register, command };
