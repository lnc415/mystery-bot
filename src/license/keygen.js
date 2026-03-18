/**
 * License Key Generator — run with: npm run keygen
 * Usage: node src/license/keygen.js [module] [label] [days]
 * Example: node src/license/keygen.js bundle "Customer A" 365
 *
 * Modules: gifbot, chatbot, buybot, sellbot, liquidity, bundle
 */

const fs   = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const KEYS_FILE = path.join(__dirname, "keys.json");

const MODULES_MAP = {
  gifbot: { name: "GIF Bot", modules: ["gifbot"], price: 10 },
  chatbot: { name: "Chatbot", modules: ["chatbot"], price: 50 },
  buybot: { name: "Buy Bot", modules: ["buybot"], price: 25 },
  sellbot: { name: "Sell Bot", modules: ["sellbot"], price: 25 },
  liquidity: { name: "Liquidity Monitor", modules: ["liquidity"], price: 25 },
  bundle: { name: "Full Package", modules: ["gifbot", "chatbot", "buybot", "sellbot", "liquidity"], price: 75 },
};

const [,, moduleKey = "bundle", label = "Customer", days = "90"] = process.argv;

if (!MODULES_MAP[moduleKey]) {
  console.error(`Unknown module "${moduleKey}". Available: ${Object.keys(MODULES_MAP).join(", ")}`);
  process.exit(1);
}

const tier = MODULES_MAP[moduleKey];

// Load existing keys
let keyStore = {};
if (fs.existsSync(KEYS_FILE)) {
  try { keyStore = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8")); } catch {}
}

// Generate key: MBOT-XXXX-XXXX-XXXX
const raw = uuidv4().replace(/-/g, "").toUpperCase();
const key = `MBOT-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;

const expires = new Date();
expires.setDate(expires.getDate() + parseInt(days));

keyStore[key] = {
  label,
  tier: moduleKey,
  modules: tier.modules,
  created: new Date().toISOString(),
  expires: expires.toISOString(),
};

fs.writeFileSync(KEYS_FILE, JSON.stringify(keyStore, null, 2));

console.log("\n✅ License key generated:");
console.log(`   Key:     ${key}`);
console.log(`   Module:  ${tier.name}`);
console.log(`   Price:   $${tier.price}`);
console.log(`   Label:   ${label}`);
console.log(`   Modules: ${tier.modules.join(", ")}`);
console.log(`   Expires: ${expires.toDateString()}`);
console.log("\nSaved to src/license/keys.json\n");
