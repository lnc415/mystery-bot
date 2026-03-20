/**
 * Stripe Checkout Router
 * Handles the buy page, Stripe session creation, success page, and webhook.
 */

const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const stripe   = require("stripe")(process.env.STRIPE_SECRET_KEY);

const products      = require("./products");
const { generateKey } = require("./keygen");

const router = express.Router();

const FULFILLED_FILE = path.join(__dirname, "fulfilled.json");
const PUBLIC_DIR     = path.join(__dirname, "../../public");
const BASE_URL       = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

// ── Helpers ────────────────────────────────────────────────────────────────

function loadFulfilled() {
  try {
    return JSON.parse(fs.readFileSync(FULFILLED_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveFulfilled(data) {
  fs.writeFileSync(FULFILLED_FILE, JSON.stringify(data, null, 2));
}

// ── GET /health ────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  res.json({ status: "ok", bot: "online" });
});

// ── GET /buy ───────────────────────────────────────────────────────────────

router.get("/buy", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "buy.html"));
});

// ── POST /api/checkout ─────────────────────────────────────────────────────
// Body: { productKey, email }
// Returns: { url } — redirect target for the frontend

router.post("/api/checkout", express.json(), async (req, res) => {
  try {
    const { productKey, email } = req.body || {};

    if (!productKey || !products[productKey]) {
      return res.status(400).json({ error: "Invalid product key" });
    }
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email required" });
    }

    const product = products[productKey];

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency:     "usd",
            unit_amount:  product.priceCents,
            product_data: {
              name:        product.name,
              description: product.description,
            },
          },
          quantity: 1,
        },
      ],
      mode:           "payment",
      customer_email: email,
      success_url:    `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:     `${BASE_URL}/buy`,
      metadata: {
        productKey,
        label: email,
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("[checkout] Session creation failed:", err.message);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── GET /success ───────────────────────────────────────────────────────────
// Query: ?session_id=...
// Injects {{KEY}} and {{PRODUCT_NAME}} into public/success.html

router.get("/success", async (req, res) => {
  const { session_id: sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).send("Missing session_id");
  }

  try {
    // Check fulfilled cache first (idempotent on refresh)
    const fulfilled = loadFulfilled();
    if (fulfilled[sessionId]) {
      const cached  = fulfilled[sessionId];
      const product = products[cached.productKey] || {};
      return serveSuccess(res, cached.key, product.name || cached.productKey);
    }

    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.send(`
        <!DOCTYPE html><html><head><title>Payment Pending</title></head>
        <body style="background:#0d0d0d;color:#fff;font-family:sans-serif;text-align:center;padding:4rem">
          <h2>Payment not yet confirmed</h2>
          <p>Please wait a moment and refresh, or <a href="/buy" style="color:#00ff88">return to buy page</a>.</p>
        </body></html>
      `);
    }

    const { productKey, label } = session.metadata || {};
    const product = products[productKey];

    if (!product) {
      return res.status(400).send("Unknown product in session metadata");
    }

    // Generate the key and cache it
    const key = generateKey(productKey, product.modules, label, product.days);

    fulfilled[sessionId] = {
      key,
      productKey,
      email:     label,
      createdAt: new Date().toISOString(),
    };
    saveFulfilled(fulfilled);

    return serveSuccess(res, key, product.name);
  } catch (err) {
    console.error("[checkout] /success error:", err.message);
    res.status(500).send("Error retrieving payment status. Please contact support.");
  }
});

function serveSuccess(res, key, productName) {
  const template = path.join(PUBLIC_DIR, "success.html");
  let html = fs.readFileSync(template, "utf8");
  html = html.replace(/\{\{KEY\}\}/g, key).replace(/\{\{PRODUCT_NAME\}\}/g, productName);
  res.send(html);
}

// ── POST /webhook ──────────────────────────────────────────────────────────
// Raw body required for Stripe signature verification.
// express.raw() is applied to this route ONLY before the router is mounted.

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig    = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error("[webhook] Signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const sessionId = session.id;

      const fulfilled = loadFulfilled();
      if (fulfilled[sessionId]) {
        // Already generated (e.g., /success was hit first)
        console.log(`[webhook] Session ${sessionId} already fulfilled, skipping`);
        return res.json({ received: true });
      }

      const { productKey, label } = session.metadata || {};
      const product = products[productKey];

      if (!product) {
        console.error(`[webhook] Unknown productKey "${productKey}" in session ${sessionId}`);
        return res.status(400).send("Unknown product");
      }

      if (session.payment_status === "paid") {
        const key = generateKey(productKey, product.modules, label, product.days);
        fulfilled[sessionId] = {
          key,
          productKey,
          email:     label,
          createdAt: new Date().toISOString(),
        };
        saveFulfilled(fulfilled);
        console.log(`[webhook] Fulfilled ${sessionId}: ${key}`);
      }
    }

    res.json({ received: true });
  }
);

module.exports = router;
