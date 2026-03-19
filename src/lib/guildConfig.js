/**
 * Guild Config Helper
 * ─────────────────────────────────────────────────────────────────
 * Central read/write layer for per-guild configuration stored in
 * src/config/guilds.json.  All other modules read/write guild data
 * through this API — nothing writes the file directly.
 *
 * Schema per guild:
 * {
 *   "GUILD_ID": {
 *     "licenseKey": "MBOT-XXXX-XXXX-XXXX-XXXX",
 *     "modules": ["gifbot", "buybot"],
 *     "email": "customer@email.com",
 *     "expiresAt": "2026-06-01",
 *     "config": {
 *       "buybot":    { "policyId": "abc123...", "channelId": "123456789" },
 *       "sellbot":   { "channelId": "123456789" },
 *       "gifbot":    { "driveUrl": "https://...", "folderId": "abc123" },
 *       "chatbot":   { "name": "MyBot", "personality": "You are..." },
 *       "liquidity": { "channelId": "123456789" }
 *     }
 *   }
 * }
 * ─────────────────────────────────────────────────────────────────
 */

const fs   = require("fs");
const path = require("path");

const GUILDS_FILE = path.join(__dirname, "../config/guilds.json");

// Always include gifbot — it is the free tier
const FREE_MODULES = ["gifbot"];

// ── Raw file helpers ────────────────────────────────────────────

function loadAll() {
  if (!fs.existsSync(GUILDS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(GUILDS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveAll(data) {
  // Ensure the directory exists
  const dir = path.dirname(GUILDS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GUILDS_FILE, JSON.stringify(data, null, 2));
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Return the full guild record, or a default empty record.
 */
function getGuildConfig(guildId) {
  const all = loadAll();
  return all[guildId] || { modules: [...FREE_MODULES], config: {} };
}

/**
 * Merge top-level fields into the guild record and persist.
 * Existing fields not in `updates` are preserved.
 */
function setGuildConfig(guildId, updates) {
  const all  = loadAll();
  const prev = all[guildId] || { modules: [...FREE_MODULES], config: {} };
  all[guildId] = { ...prev, ...updates };
  saveAll(all);
  return all[guildId];
}

/**
 * Return the config sub-object for a specific module, or {}.
 */
function getModuleConfig(guildId, module) {
  const guild = getGuildConfig(guildId);
  return (guild.config || {})[module] || {};
}

/**
 * Merge fields into the module-level config object and persist.
 */
function setModuleConfig(guildId, module, updates) {
  const all  = loadAll();
  if (!all[guildId])           all[guildId] = { modules: [...FREE_MODULES], config: {} };
  if (!all[guildId].config)    all[guildId].config = {};
  const prev = all[guildId].config[module] || {};
  all[guildId].config[module] = { ...prev, ...updates };
  saveAll(all);
  return all[guildId].config[module];
}

/**
 * Returns true if the guild has the given module licensed (or it's free).
 * gifbot is always free and always returns true.
 */
function hasModule(guildId, module) {
  if (FREE_MODULES.includes(module)) return true;
  const guild = getGuildConfig(guildId);
  return Array.isArray(guild.modules) && guild.modules.includes(module);
}

/**
 * Return the list of licensed modules for a guild (always includes free ones).
 */
function getModules(guildId) {
  const guild = getGuildConfig(guildId);
  const set   = new Set([...FREE_MODULES, ...(guild.modules || [])]);
  return [...set];
}

/**
 * Return an array of guildIds that are eligible for DEX monitoring.
 * A guild qualifies if it has at least one of buybot, sellbot, or liquidity
 * licensed AND has a policyId configured in one of those modules.
 *
 * @returns {string[]}
 */
function getActiveMonitoringGuilds() {
  const all = loadAll();
  const active = [];

  for (const [guildId, guild] of Object.entries(all)) {
    const modules = Array.isArray(guild.modules) ? guild.modules : [];
    const cfg     = guild.config || {};

    const hasBuybot    = modules.includes("buybot")    || modules.includes("sellbot") || modules.includes("liquidity");
    if (!hasBuybot) continue;

    // Check if any monitoring module has a policyId configured
    const policyId =
      cfg.buybot?.policyId ||
      cfg.sellbot?.policyId ||
      cfg.liquidity?.policyId ||
      "";

    if (policyId) active.push(guildId);
  }

  return active;
}

module.exports = {
  getGuildConfig,
  setGuildConfig,
  getModuleConfig,
  setModuleConfig,
  hasModule,
  getModules,
  getActiveMonitoringGuilds,
  FREE_MODULES,
};
