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

app.post("/api/checkout", (req, res) => {
  if (!stripe) {
    return res.status(400).json({ error: "Stripe not configured" });
  }

  const { tier, email } = req.body;
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
    success_url: `${process.env.DOMAIN || "http://localhost:3001"}/success?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.DOMAIN || "http://localhost:3001"}/cancel`,
    metadata: { tier, email },
  }).then(session => {
    res.json({ sessionId: session.id, url: session.url });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

// ─── Stripe webhook (license auto-generation) ─────────────────

app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe) return res.status(400).send("Stripe not configured");

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn("[Stripe] STRIPE_WEBHOOK_SECRET not set");
    return res.status(400).send("Webhook secret not configured");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  // Handle payment success
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { tier, email } = session.metadata;

    if (!pricing[tier]) {
      console.error(`[Stripe] Unknown tier: ${tier}`);
      return res.status(400).send("Unknown tier");
    }

    // Generate license
    const key = `MBOT-${uuidv4().slice(0, 8).toUpperCase()}`;
    const expires = new Date();
    expires.setDate(expires.getDate() + 365); // 1-year license

    licenses[key] = {
      tier,
      label: email,
      modules: pricing[tier].modules,
      created: new Date().toISOString(),
      expires: expires.toISOString(),
      paymentId: session.payment_intent,
    };

    save(LICENSES_FILE, licenses);

    // TODO: Email key to customer
    console.log(`[License] Generated for ${email}: ${key}`);
  }

  res.json({ received: true });
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
