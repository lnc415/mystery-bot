/**
 * Mystery Bot Dashboard — Owner Interface
 * ─────────────────────────────────────────────────────────────────
 * Set pricing tiers → Stripe integration → Auto-license on payment
 * ─────────────────────────────────────────────────────────────────
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");
const { v4: uuidv4 } = require("uuid");
const Stripe  = require("stripe");

// Bot's keys.json — where license keys live for the Discord bot
const BOT_KEYS_FILE = path.join(__dirname, "../src/license/keys.json");

require("dotenv").config();

const app = express();

// ── Middleware ─────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Config storage (JSON for simplicity) ───────────────────────

const CONFIG_FILE = path.join(__dirname, "data", "config.json");
const LICENSES_FILE = path.join(__dirname, "data", "licenses.json");
const PRICING_FILE = path.join(__dirname, "data", "pricing.json");

if (!fs.existsSync(path.join(__dirname, "data"))) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
}

function ensureFile(file, defaults) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2));
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

let config   = ensureFile(CONFIG_FILE, { ownerPassword: "change-me", stripeKey: "" });
let licenses = ensureFile(LICENSES_FILE, {});
let pricing  = ensureFile(PRICING_FILE, {
  starter: { name: "Starter", price: 29, modules: ["gifbot", "chatbot"], description: "GIF bot + chatbot" },
  trader:  { name: "Trader",  price: 79, modules: ["gifbot", "buybot", "sellbot"], description: "Trading alerts" },
  pro:     { name: "Pro",     price: 199, modules: ["gifbot", "chatbot", "buybot", "sellbot", "liquidity"], description: "Everything" },
});

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Key generation helper ───────────────────────────────────────

function generateKey() {
  const raw = uuidv4().replace(/-/g, "").toUpperCase();
  return `MBOT-${raw.slice(0,4)}-${raw.slice(4,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}`;
}

// ── Bot keys.json sync ──────────────────────────────────────────
// Writes a new license entry into the bot's keys.json so the bot
// can validate it locally (or via /api/validate-license below).

function writeBotKey(key, entry) {
  let botKeys = {};
  if (fs.existsSync(BOT_KEYS_FILE)) {
    try { botKeys = JSON.parse(fs.readFileSync(BOT_KEYS_FILE, "utf8")); } catch {}
  }
  botKeys[key] = entry;
  fs.writeFileSync(BOT_KEYS_FILE, JSON.stringify(botKeys, null, 2));
  console.log(`[BotKeys] Wrote ${key} → ${BOT_KEYS_FILE}`);
}

// ── Stripe setup ───────────────────────────────────────────────

const stripe = config.stripeKey ? new Stripe(config.stripeKey) : null;

// ── Routes ─────────────────────────────────────────────────────

// Owner auth (simple token-based for now)
let authToken = null;

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body;
  if (password === config.ownerPassword) {
    authToken = uuidv4();
    return res.json({ token: authToken });
  }
  res.status(401).json({ error: "Invalid password" });
});

// Middleware: check auth token
function requireAuth(req, res, next) {
  if (req.headers.authorization === `Bearer ${authToken}`) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

// ─── GET pricing tiers ────────────────────────────────────────

app.get("/api/pricing", (req, res) => {
  res.json(pricing);
});

// ─── UPDATE pricing tier ──────────────────────────────────────

app.post("/api/pricing/:tier", requireAuth, (req, res) => {
  const { tier } = req.params;
  const { name, price, modules, description } = req.body;

  if (!tier || price < 0) {
    return res.status(400).json({ error: "Invalid tier or price" });
  }

  pricing[tier] = { name, price, modules, description };
  save(PRICING_FILE, pricing);
  res.json({ success: true, tier: pricing[tier] });
});

// ─── GET all licenses ─────────────────────────────────────────

app.get("/api/licenses", requireAuth, (req, res) => {
  const all = Object.entries(licenses).map(([key, data]) => ({
    key,
    ...data,
    daysRemaining: data.expires
      ? Math.ceil((new Date(data.expires) - new Date()) / (1000 * 60 * 60 * 24))
      : null,
  }));
  res.json(all);
});

// ─── GENERATE license (manual) ───────────────────────────────

app.post("/api/licenses/generate", requireAuth, (req, res) => {
  const { tier = "pro", label, days = 365 } = req.body;
  if (!pricing[tier]) {
    return res.status(400).json({ error: "Unknown tier" });
  }

  const key = `MBOT-${uuidv4().slice(0, 8).toUpperCase()}`;
  const expires = new Date();
  expires.setDate(expires.getDate() + days);

  licenses[key] = {
    tier,
    label: label || `Manual - ${new Date().toISOString().split("T")[0]}`,
    modules: pricing[tier].modules,
    created: new Date().toISOString(),
    expires: expires.toISOString(),
  };

  save(LICENSES_FILE, licenses);
  res.json({ key, ...licenses[key] });
});

// ─── DELETE license ───────────────────────────────────────────

app.delete("/api/licenses/:key", requireAuth, (req, res) => {
  const { key } = req.params;
  delete licenses[key];
  save(LICENSES_FILE, licenses);
  res.json({ success: true });
});

// ─── Stripe checkout session ──────────────────────────────────
// Supports two modes:
//   { tier, email }         — single tier purchase (legacy)
//   { modules: [...], email } — per-module selection from /buy page

app.post("/api/checkout", (req, res) => {
  if (!stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  const { tier, modules: selectedModules, email } = req.body;
  const domain = process.env.DOMAIN || "http://localhost:3001";

  // Per-module selection mode
  if (selectedModules && Array.isArray(selectedModules)) {
    if (!email) return res.status(400).json({ error: "Email required" });
    if (!selectedModules.length) return res.status(400).json({ error: "Select at least one module" });

    // Compute total from pricing.json
    let totalCents = 0;
    const purchasedModuleSet = new Set();
    const lineItems = [];

    for (const m of selectedModules) {
      const p = pricing[m];
      if (!p) return res.status(400).json({ error: `Unknown module: ${m}` });
      totalCents += Math.round(p.price * 100);
      (p.modules || []).forEach(mod => purchasedModuleSet.add(mod));
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: `Mystery Bot — ${p.name}`, description: p.description },
          unit_amount: Math.round(p.price * 100),
        },
        quantity: 1,
      });
    }

    const moduleList = [...purchasedModuleSet].join(",");

    return stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems,
      customer_email: email,
      success_url: `${domain}/success?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/buy`,
      metadata: { modules: moduleList, email, tier: selectedModules.join(",") },
    }).then(session => {
      res.json({ sessionId: session.id, url: session.url });
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  }

  // Legacy single-tier mode
  const tierData = pricing[tier];
  if (!tierData) {
    return res.status(400).json({ error: "Unknown tier" });
  }

  stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Mystery Bot ${tierData.name}`,
            description: tierData.description,
          },
          unit_amount: Math.round(tierData.price * 100),
        },
        quantity: 1,
      },
    ],
    customer_email: email,
    success_url: `${domain}/success?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${domain}/buy`,
    metadata: { tier, email, modules: (tierData.modules || []).join(",") },
  }).then(session => {
    res.json({ sessionId: session.id, url: session.url });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// ─── Stripe webhook (license auto-generation) ─────────────────

// Pending licenses keyed by Stripe session ID — read by /success page
const pendingLicenses = {};

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe) return res.status(400).send("Stripe not configured");

  const sig           = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  if (webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }
  } else {
    // Dev mode: accept raw JSON (no signature verification)
    console.warn("[Stripe] STRIPE_WEBHOOK_SECRET not set — skipping signature check");
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      return res.status(400).send("Invalid JSON");
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { tier, email, modules: moduleList } = session.metadata;

    // Resolve modules from metadata
    let resolvedModules = [];
    if (moduleList) {
      resolvedModules = moduleList.split(",").filter(Boolean);
    } else if (tier && pricing[tier]) {
      resolvedModules = pricing[tier].modules || [];
    }

    // Deduplicate
    resolvedModules = [...new Set(resolvedModules)];

    // Generate proper MBOT key
    const key     = generateKey();
    const expires = new Date();
    expires.setDate(expires.getDate() + 365); // 1-year license

    const licenseEntry = {
      tier:      tier || "custom",
      label:     email,
      modules:   resolvedModules,
      created:   new Date().toISOString(),
      expires:   expires.toISOString(),
      paymentId: session.payment_intent,
      stripeSessionId: session.id,
      guildId:   null, // set when user runs /license in Discord
    };

    // Store in dashboard licenses
    licenses[key] = licenseEntry;
    save(LICENSES_FILE, licenses);

    // Write to bot's keys.json so /license command can validate locally
    writeBotKey(key, licenseEntry);

    // Cache for /api/pending-license endpoint (success page pickup)
    pendingLicenses[session.id] = { key, ...licenseEntry };

    // TODO: Send email to customer with key (plug in SendGrid / Resend here)
    console.log(`[License] Generated ${key} for ${email} — modules: ${resolvedModules.join(", ")}`);
  }

  res.json({ received: true });
});

// ─── Pending license lookup (for success page) ────────────────
// The success page calls this with ?session=SESSION_ID to get the key.

app.get("/api/pending-license", (req, res) => {
  const { session } = req.query;
  if (!session) return res.status(400).json({ error: "session required" });

  const pending = pendingLicenses[session];
  if (!pending) {
    // Try looking up in licenses by stripeSessionId (persisted)
    const found = Object.entries(licenses).find(
      ([, v]) => v.stripeSessionId === session
    );
    if (found) return res.json({ key: found[0], ...found[1] });
    return res.status(404).json({ error: "License not found yet. Try again in a moment." });
  }

  res.json(pending);
});

// ─── Validate license (called by bot's manager.js) ────────────

app.post("/api/validate-license", (req, res) => {
  const { key, guildId } = req.body;
  if (!key) return res.json({ valid: false, reason: "No key provided" });

  const entry = licenses[key.trim()];
  if (!entry) {
    // Also check bot's own keys.json
    let botKeys = {};
    try { botKeys = JSON.parse(fs.readFileSync(BOT_KEYS_FILE, "utf8")); } catch {}
    const botEntry = botKeys[key.trim()];
    if (!botEntry) return res.json({ valid: false, reason: "Unknown key" });

    const expired = botEntry.expires && new Date(botEntry.expires) < new Date();
    if (expired) return res.json({ valid: false, reason: "Expired" });
    if (botEntry.guildId && guildId && botEntry.guildId !== guildId) {
      return res.json({ valid: false, reason: "Bound to different guild" });
    }
    return res.json({ valid: true, modules: botEntry.modules, tier: botEntry.tier });
  }

  const expired = entry.expires && new Date(entry.expires) < new Date();
  if (expired) return res.json({ valid: false, reason: "Expired" });
  if (entry.guildId && guildId && entry.guildId !== guildId) {
    return res.json({ valid: false, reason: "Bound to different guild" });
  }
  res.json({ valid: true, modules: entry.modules, tier: entry.tier });
});

// ─── GET dashboard config (for frontend) ──────────────────────

app.get("/api/config", requireAuth, (req, res) => {
  res.json({
    stripeConfigured: !!stripe,
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY,
  });
});

// ─── Settings (owner) ─────────────────────────────────────────

app.post("/api/settings", requireAuth, (req, res) => {
  const { newPassword, stripeKey } = req.body;
  if (newPassword) config.ownerPassword = newPassword;
  if (stripeKey) config.stripeKey = stripeKey;
  save(CONFIG_FILE, config);
  res.json({ success: true });
});

// ── Customer-facing pages ───────────────────────────────────────

// /buy  — module selection + checkout page (public)
app.get("/buy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "buy.html"));
});

// /success — post-payment key reveal page (public)
app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "success.html"));
});

// /cancel — return to buy page
app.get("/cancel", (req, res) => {
  res.redirect("/buy");
});

// ── 404 / Static ───────────────────────────────────────────────

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ──────────────────────────────────────────────────────

const PORT = process.env.DASHBOARD_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n📊 Mystery Bot Dashboard`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Login with password: ${config.ownerPassword}\n`);
});
