/**
 * Image Sources — Multi-source image picker
 * ─────────────────────────────────────────────────────────────────
 * Priority order:
 *   1. Google Drive folder (if configured for this guild via /setup gifbot)
 *   2. Local folder        (assets/gifs/ or legacy ./gifs/)
 *   3. Built-in defaults   (hardcoded fallback URLs)
 *
 * Drive config is read from guildConfig (guilds.json config.gifbot).
 * Writing Drive config is handled by /setup gifbot through guildConfig.
 * ─────────────────────────────────────────────────────────────────
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");

const { getModuleConfig } = require("./guildConfig");

// ── Built-in fallback URLs ─────────────────────────────────────

// Fallback GIFs — stable Tenor/media URLs that Discord can embed directly.
// Replace these with on-brand images once a Drive folder is configured.
const DEFAULT_URLS = [
  "https://media.tenor.com/dQFMrXkDhB8AAAAC/detective-magnifying-glass.gif",
  "https://media.tenor.com/AoHsKjRklMEAAAAC/detective-clue.gif",
  "https://media.tenor.com/5FBPpDCNB6QAAAAC/mystery-sherlock.gif",
];

// ── Local folder lookup ────────────────────────────────────────

const IMAGE_EXTENSIONS = [".gif", ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm"];

const LOCAL_DIRS = [
  path.resolve(__dirname, "../../assets/gifs"),
  path.resolve(__dirname, "../../gifs"),
];

function pickLocalImage() {
  for (const dir of LOCAL_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) =>
      IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase())
    );
    if (files.length) {
      const chosen = files[Math.floor(Math.random() * files.length)];
      return { url: path.join(dir, chosen), name: chosen, isLocal: true };
    }
  }
  return null;
}

// ── Google Drive helpers ───────────────────────────────────────

/**
 * Extract folder ID from a Google Drive folder URL.
 */
function extractFolderId(folderUrl) {
  const match = folderUrl.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Build a direct-view URL for a Drive file.
 */
function driveFileUrl(fileId) {
  // lh3.googleusercontent.com serves the image directly — Discord can embed it
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Fetch image files from a public Google Drive folder via API.
 */
async function fetchDriveFiles(folderId) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");

  const query  = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image'`);
  const fields = encodeURIComponent("files(id,name,mimeType)");
  const url    = `https://www.googleapis.com/drive/v3/files?q=${query}&key=${apiKey}&fields=${fields}`;

  const res = await axios.get(url, { timeout: 8000 });

  if (!res.data || !Array.isArray(res.data.files)) {
    throw new Error("Unexpected Drive API response");
  }

  return res.data.files;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Get a random image for the given guild.
 * Returns { url, name, source } where source is "drive" | "local" | "default".
 *
 * Drive config is read from guilds.json via guildConfig.getModuleConfig().
 */
async function getRandomImage(guildId) {
  const gifCfg = getModuleConfig(guildId, "gifbot");
  const folderId = gifCfg.folderId || (gifCfg.driveUrl ? extractFolderId(gifCfg.driveUrl) : null);

  // 1. Try Google Drive
  if (folderId) {
    if (!process.env.GOOGLE_API_KEY) {
      console.warn("[ImageSources] GOOGLE_API_KEY not set — skipping Drive, using fallback");
    } else {
      try {
        const files = await fetchDriveFiles(folderId);
        if (files.length === 0) {
          console.warn("[ImageSources] Drive folder has no images — falling back");
        } else {
          const chosen = files[Math.floor(Math.random() * files.length)];
          return { url: driveFileUrl(chosen.id), name: chosen.name, source: "drive" };
        }
      } catch (err) {
        console.error("[ImageSources] Drive fetch failed:", err.message, "— falling back");
      }
    }
  }

  // 2. Try local folder
  const local = pickLocalImage();
  if (local) return { url: local.url, name: local.name, source: "local" };

  // 3. Built-in defaults
  const url = DEFAULT_URLS[Math.floor(Math.random() * DEFAULT_URLS.length)];
  return { url, name: "mystery.gif", source: "default" };
}

/**
 * Test that a Drive folder URL is accessible and contains images.
 * Returns { ok, fileCount, error }.
 * Used by /setup gifbot to validate before saving.
 */
async function testGoogleDriveFolder(folderUrl) {
  if (!process.env.GOOGLE_API_KEY) {
    return {
      ok: false,
      fileCount: 0,
      error: "GOOGLE_API_KEY is not configured on the bot server. Contact the bot owner.",
    };
  }

  const folderId = extractFolderId(folderUrl);
  if (!folderId) {
    return {
      ok: false,
      fileCount: 0,
      error: "Invalid folder URL. Copy the full Google Drive folder link.",
    };
  }

  try {
    const files = await fetchDriveFiles(folderId);
    if (files.length === 0) {
      return {
        ok: false,
        fileCount: 0,
        error: "Folder is accessible but contains no images. Add some GIF/JPG/PNG files to it.",
      };
    }
    return { ok: true, fileCount: files.length, error: null };
  } catch (err) {
    if (err.response && (err.response.status === 403 || err.response.status === 401)) {
      return {
        ok: false,
        fileCount: 0,
        error:
          "Folder is private. Share it: right-click → Share → Anyone with the link → Viewer.",
      };
    }
    return { ok: false, fileCount: 0, error: `Drive API error: ${err.message}` };
  }
}

module.exports = {
  getRandomImage,
  testGoogleDriveFolder,
  extractFolderId,
};
