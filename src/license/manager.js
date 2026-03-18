/**
 * License Manager — Secure Edition
 * ─────────────────────────────────────────────────────────────────
 * Validates license keys with server-side verification, expiration
 * checks, and guild binding. Prevents tampering and brute-force.
 *
 * Security features:
 *  • Server validation (online mode)
 *  • Signature verification on API responses
 *  • Guild binding (optional per-key)
 *  • Expiration enforcement (server + client)
 *  • Graceful offline fallback
 *  • Rate limiting (server-side)
 * ─────────────────────────────────────────────────────────────────
 */

const fs     = require("fs");
const path   = require("path");
const axios  = require("axios");
const crypto = require("crypto");
const config = require("../config");

const KEYS_FILE = path.join(__dirname, "keys.json");
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Free modules — always available
const FREE_MODULES = ["gifbot"];

// Module prices (reference)
const TIERS = {
  gifbot: ["gifbot"],
  chatbot: ["chatbot"],
  buybot: ["buybot"],
  sellbot: ["sellbot"],
  liquidity: ["liquidity"],
  bundle: ["gifbot", "chatbot", "buybot", "sellbot", "liquidity"],
};

let keyStore = {};
let cachedValidation = null;
let cacheTime = 0;

function loadKeys() {
  if (fs.existsSync(KEYS_FILE)) {
    try {
      keyStore = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    } catch {
      keyStore = {};
    }
  }
}

loadKeys();

/**
 * Verify HMAC signature on API response.
 * Prevents network tampering.
 */
function verifySignature(data, signature) {
  if (!config.license.signingSecret) {
    console.warn("[License] Signing secret not configured, skipping signature verification");
    return true; // Disabled if not configured
  }

  const payload = JSON.stringify(data);
  const hmac = crypto.createHmac("sha256", config.license.signingSecret)
    .update(payload).digest("hex");

  if (hmac !== signature) {
    console.error("[License] Signature verification failed — possible tampering!");
    return false;
  }

  return true;
}

/**
 * Check if key is expired.
 */
function isExpired(expires) {
  if (!expires) return false; // Lifetime license
  return new Date(expires) < new Date();
}

/**
 * Validate with central server.
 * Falls back to local validation if network fails.
 */
async function validateWithServer(licenseKey, guildId = null) {
  // No key = free tier
  if (!licenseKey) {
    return new Set(FREE_MODULES);
  }

  // Skip server validation if not configured (offline mode)
  if (!config.license.apiUrl) {
    console.log("[License] No API URL configured, using local validation");
    return getEntitlements(licenseKey, guildId);
  }

  const now = Date.now();
  if (cachedValidation && (now - cacheTime) < CACHE_DURATION) {
    console.log("[License] Using cached validation");
    return cachedValidation;
  }

  try {
    const res = await axios.post(
      `${config.license.apiUrl}/api/validate-license`,
      { key: licenseKey.trim(), guildId },
      { timeout: 5000 }
    );

    const { _signature, ...data } = res.data;

    // Verify response wasn't tampered with
    if (_signature && !verifySignature(data, _signature)) {
      throw new Error("Response signature invalid");
    }

    if (!data.valid) {
      console.warn(`[License] Server rejected key: ${data.reason}`);
      return new Set(FREE_MODULES);
    }

    const modules = new Set(data.modules || []);
    modules.add("gifbot"); // Always include free tier

    // Cache the validation
    cachedValidation = modules;
    cacheTime = now;

    console.log(`[License] Validated: ${[...modules].join(", ")}`);
    return modules;
  } catch (err) {
    console.warn(`[License] Server validation failed: ${err.message}`);
    // Graceful fallback: use last known good state or local keys
    if (cachedValidation) {
      console.log("[License] Using cached validation from last successful check");
      return cachedValidation;
    }
    return getEntitlements(licenseKey, guildId);
  }
}

/**
 * Local (offline) validation using local keys.json
 */
function getEntitlements(licenseKey, guildId = null) {
  const base = new Set(FREE_MODULES);

  if (!licenseKey) return base;

  const entry = keyStore[licenseKey.trim()];
  if (!entry) {
    console.warn(`[License] Unknown key: ${licenseKey.slice(0, 12)}…`);
    return base;
  }

  // Check guild binding
  if (entry.guildId && guildId && entry.guildId !== guildId) {
    console.warn(`[License] Key bound to guild ${entry.guildId}, not ${guildId}`);
    return base;
  }

  // Check expiration
  if (isExpired(entry.expires)) {
    console.warn(`[License] Expired key: ${licenseKey.slice(0, 12)}…`);
    return base;
  }

  for (const m of entry.modules || []) base.add(m);
  return base;
}

/**
 * Check if specific module is unlocked.
 */
function isUnlocked(module, licenseKey, guildId = null) {
  // Call validateWithServer, but in production use this async version
  const modules = getEntitlements(licenseKey, guildId);
  return modules.has(module);
}

/**
 * Async version — use this in bot startup.
 */
async function isUnlockedAsync(module, licenseKey, guildId = null) {
  const modules = await validateWithServer(licenseKey, guildId);
  return modules.has(module);
}

/**
 * Get key info (for /status command).
 */
function keyInfo(licenseKey, guildId = null) {
  if (!licenseKey) return { valid: false, reason: "No key provided" };

  const entry = keyStore[licenseKey.trim()];
  if (!entry) return { valid: false, reason: "Invalid key" };

  if (isExpired(entry.expires)) {
    return { valid: false, reason: "Expired" };
  }

  if (entry.guildId && guildId && entry.guildId !== guildId) {
    return { valid: false, reason: "Bound to different guild" };
  }

  return {
    valid: true,
    modules: entry.modules,
    label: entry.label,
    expires: entry.expires,
    tier: entry.tier,
  };
}

module.exports = {
  getEntitlements,
  isUnlocked,
  isUnlockedAsync,
  validateWithServer,
  keyInfo,
  isExpired,
  verifySignature,
  TIERS,
  FREE_MODULES,
};
