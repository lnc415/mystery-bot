/**
 * Image URL helpers for buy-tier configuration
 * ─────────────────────────────────────────────────────────────────
 * resolveImageUrl(rawUrl) → { ok, url, error }
 *   - Google Drive file link  → converts to direct uc?export=view link
 *   - Google Drive folder link → returns error (folders are not images)
 *   - Any other URL           → HEAD-checks reachability, returns as-is
 *
 * isDriveUrl(url) → boolean
 * extractDriveFileId(url) → string | null
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * Returns true if the URL is any Google Drive link.
 * @param {string} url
 * @returns {boolean}
 */
function isDriveUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === "drive.google.com";
  } catch {
    return false;
  }
}

/**
 * Extract the file ID from a Google Drive file URL.
 * Handles:
 *   https://drive.google.com/file/d/FILE_ID/view
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID
 *
 * Returns null if the URL is a folder link or cannot be parsed.
 * @param {string} url
 * @returns {string|null}
 */
function extractDriveFileId(url) {
  try {
    const u = new URL(url);

    // Folder links — not supported
    if (u.pathname.includes("/folders/")) return null;

    // /file/d/FILE_ID/...
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) return fileMatch[1];

    // ?id=FILE_ID  (open or uc links)
    const idParam = u.searchParams.get("id");
    if (idParam) return idParam;

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a raw image URL entered by the user into a canonical direct URL.
 *
 * @param {string} rawUrl
 * @returns {Promise<{ ok: boolean, url?: string, error?: string }>}
 */
async function resolveImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, error: "No URL provided." };
  }

  const trimmed = rawUrl.trim();

  // ── Google Drive handling ──────────────────────────────────────
  if (isDriveUrl(trimmed)) {
    // Reject folder links
    try {
      const u = new URL(trimmed);
      if (u.pathname.includes("/folders/")) {
        return {
          ok: false,
          error: "Use a file link, not a folder link. Open the file in Drive, then share that specific file.",
        };
      }
    } catch {
      return { ok: false, error: "Invalid Google Drive URL." };
    }

    const fileId = extractDriveFileId(trimmed);
    if (!fileId) {
      return {
        ok: false,
        error: "Could not extract a file ID from that Google Drive link. Use a direct file share link.",
      };
    }

    // Use lh3.googleusercontent.com — Discord can embed this directly
    // drive.google.com/uc?export=view often shows a confirmation page
    const directUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    return { ok: true, url: directUrl };
  }

  // ── Generic URL: HEAD check ────────────────────────────────────
  try {
    // Basic URL validity check before fetching
    new URL(trimmed);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(trimmed, {
      method:  "HEAD",
      signal:  controller.signal,
      headers: { "User-Agent": "MysteryBot/1.0 (image-url-validator)" },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return {
        ok: false,
        error: `URL returned HTTP ${res.status}. Make sure the image is publicly accessible.`,
      };
    }

    return { ok: true, url: trimmed };
  } catch (err) {
    if (err.name === "AbortError") {
      return { ok: false, error: "URL check timed out. Make sure it's publicly accessible." };
    }
    return { ok: false, error: "Could not reach that image URL. Make sure it's publicly accessible." };
  }
}

module.exports = { resolveImageUrl, isDriveUrl, extractDriveFileId };
