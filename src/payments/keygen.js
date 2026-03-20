/**
 * Programmatic key generator — called by the web payment handler.
 * Factored out of src/license/keygen.js so it can be imported directly.
 *
 * Generates a key in MBOT-XXXX-XXXX-XXXX-XXXX format,
 * loads existing keys.json, appends the new key, and writes back.
 */

const fs   = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const KEYS_FILE = path.join(__dirname, "../license/keys.json");

/**
 * Generate a license key and persist it to keys.json.
 *
 * @param {string}   productKey  — catalog key, e.g. "buybot"
 * @param {string[]} modules     — module list from products catalog
 * @param {string}   label       — customer email / identifier
 * @param {number}   days        — license duration in days
 * @returns {string} the generated key, e.g. "MBOT-A1B2-C3D4-E5F6-G7H8"
 */
function generateKey(productKey, modules, label, days) {
  // Load existing key store
  let keyStore = {};
  if (fs.existsSync(KEYS_FILE)) {
    try {
      keyStore = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    } catch (e) {
      console.error("[keygen] Failed to parse keys.json, starting fresh:", e.message);
    }
  }

  // Build key: MBOT-XXXX-XXXX-XXXX-XXXX
  const raw = uuidv4().replace(/-/g, "").toUpperCase();
  const key = `MBOT-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;

  const now     = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + days);

  keyStore[key] = {
    label,
    tier:    productKey,
    modules,
    created: now.toISOString(),
    expires: expires.toISOString(),
  };

  fs.writeFileSync(KEYS_FILE, JSON.stringify(keyStore, null, 2));
  console.log(`[keygen] Generated key ${key} for ${label} (${productKey}, ${days} days)`);

  return key;
}

module.exports = { generateKey };
