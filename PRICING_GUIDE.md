# Pricing & Licensing Architecture

## 🎯 The Business Model

**Mystery Bot** is sold as modular features with three tiers:

| Tier | Price | Modules | Target |
|------|-------|---------|--------|
| **Starter** | $29/yr | GIF Bot, Chatbot | Community engagement |
| **Trader** | $79/yr | GIF Bot, Buy/Sell alerts | Active traders |
| **Pro** | $199/yr | Everything | Full featured servers |

---

## 🔑 License Key Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (Bot Owner)                          │
│                  Set Pricing Tiers                          │
│              (Dashboard → Pricing tab)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ├─ Manual: Generate keys in Dashboard
                       │
                       └─ Automatic: Stripe webhook
                            ↓
┌──────────────────────────────────────────────────────────────┐
│              CUSTOMER BUYS ON STRIPE                         │
│        (Your checkout page + Stripe integration)            │
│                                                              │
│  Customer pays → Webhook fires → Key auto-generated         │
│                                                              │
│  Dashboard shows: LICENSE_KEY=MBOT-XXXX-XXXX-XXXX-XXXX     │
│  Email sent: "Your license key is: MBOT-..."              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────┐
│           CUSTOMER DEPLOYS THEIR BOT                         │
│                                                              │
│  Sets LICENSE_KEY in their .env                            │
│  Runs: npm start                                           │
│                                                              │
│  Bot checks license → Features unlock ✅                    │
└──────────────────────────────────────────────────────────────┘
```

---

## 💻 Implementation Details

### Where License Keys Live

**Your Dashboard** (`mystery-bot/dashboard/data/licenses.json`):
```json
{
  "MBOT-abc1-def2-ghi3-jkl4": {
    "tier": "pro",
    "label": "customer@example.com",
    "modules": ["gifbot", "chatbot", "buybot", "sellbot", "liquidity"],
    "created": "2026-01-15T10:00:00Z",
    "expires": "2027-01-15T10:00:00Z"
  }
}
```

**Customer's Bot** (when they set `LICENSE_KEY=MBOT-abc1-def2-ghi3-jkl4`):
- Bot calls `license/manager.js` → reads YOUR dashboard's `keys.json`
- Wait, that won't work. They need to either:
  - **Option A**: Run their own dashboard (self-hosted licensing)
  - **Option B**: API call to your dashboard (centralized licensing)

---

## 🏗️ Two Licensing Models

### Model A: Self-Hosted (Simpler for Users)

**Flow:**
1. Customer buys license from you
2. You generate key in dashboard
3. Key is added to your `keys.json`
4. Customer downloads your bot + their copy of `keys.json`
5. They run `npm start` with their key in `.env`

**Pros:**
- Simple, works offline
- No phone-home required
- Customer controls everything

**Cons:**
- You have to manually generate/email keys
- Keys are shared (could be distributed)

### Model B: Centralized (More Control)

**Flow:**
1. Customer buys on your Stripe checkout
2. Webhook fires → key auto-generated in YOUR dashboard
3. Key stored in your central database
4. Customer's bot validates against YOUR API on startup
5. Bot calls `/api/validate-license/MBOT-...` → gets module list

**Pros:**
- Automatic, scalable
- Can revoke keys remotely
- One source of truth
- Can track which customers use what
- Monthly/subscription billing possible

**Cons:**
- Requires internet connection (single point of failure)
- Your API is a dependency

---

## 🚀 Recommended Setup (Model B + API)

Let me show you how to add centralized licensing validation:

### 1. Add License Validation API to Dashboard

Edit `dashboard/server.js` and add:

```javascript
// ── Validate license (for customer bots) ────────────────────

app.post("/api/validate-license/:key", (req, res) => {
  const { key } = req.params;
  const entry = licenses[key];

  if (!entry) {
    return res.json({ valid: false, reason: "Invalid key" });
  }

  if (entry.expires && new Date(entry.expires) < new Date()) {
    return res.json({ valid: false, reason: "Expired" });
  }

  res.json({
    valid: true,
    modules: entry.modules,
    tier: entry.tier,
    expires: entry.expires,
  });
});
```

### 2. Update Bot's License Manager

Edit `src/license/manager.js`:

```javascript
const config = require("../config");
const axios = require("axios");

async function validateRemote(licenseKey) {
  if (!config.licenseApiUrl) {
    // Fallback to local (offline mode)
    return getEntitlements(licenseKey);
  }

  try {
    const res = await axios.post(
      `${config.licenseApiUrl}/api/validate-license/${licenseKey}`
    );

    if (res.data.valid) {
      const modules = new Set(res.data.modules);
      modules.add("gifbot"); // Free tier always included
      return modules;
    }
  } catch (err) {
    console.warn("[License] Remote validation failed, using local keys");
  }

  // Fallback to local if remote fails
  return getEntitlements(licenseKey);
}

module.exports = { validateRemote, getEntitlements, isUnlocked };
```

### 3. Add to Bot's Config

Edit `src/config.js`:

```javascript
license: {
  key: optional("LICENSE_KEY"),
  apiUrl: optional("LICENSE_API_URL"), // https://your-dashboard.com
},
```

### 4. Use in Bot Startup

Edit `src/index.js`:

```javascript
const license = require("./license/manager");

client.once("ready", async () => {
  const entitlements = await license.validateRemote(config.license.key);
  console.log(`✅ Modules unlocked: ${[...entitlements].join(", ")}`);
});
```

---

## 💳 Stripe Integration Steps

### 1. Create Stripe Account

- Go to https://stripe.com → Sign up
- Verify email
- Get test keys (use these for testing):
  - Publishable key: `pk_test_...`
  - Secret key: `sk_test_...`

### 2. Create Products in Stripe

```bash
# Using Stripe CLI or dashboard
# Create product for each tier:
# - Starter: $29
# - Trader: $79
# - Pro: $199
```

### 3. Get Webhook Secret

Stripe Dashboard → Webhooks → Create endpoint:
- URL: `https://your-domain.com/api/webhooks/stripe`
- Events: `checkout.session.completed`
- Signing secret: `whsec_...` ← Copy this

### 4. Add to Dashboard `.env`

```bash
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
DOMAIN=http://localhost:3001  # for testing
```

### 5. Test with Stripe CLI

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Listen for webhooks
stripe listen --forward-to localhost:3001/api/webhooks/stripe

# Get webhook signing secret from output, add to .env

# Test payment flow
stripe trigger payment_intent.succeeded

# Check dashboard → Licenses tab
# New key should appear automatically!
```

---

## 📧 Email Notifications (Optional)

Add license key email delivery. Edit `dashboard/server.js`:

```javascript
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// In the webhook handler:
if (event.type === "checkout.session.completed") {
  const session = event.data.object;
  const { tier, email } = session.metadata;
  const key = `MBOT-${uuidv4().slice(0, 8).toUpperCase()}`;

  // ... (save license) ...

  // Send email
  await transporter.sendMail({
    from: "noreply@mystery-bot.com",
    to: email,
    subject: "🎉 Your Mystery Bot License",
    html: `
      <h2>Welcome!</h2>
      <p>Your <strong>${tier}</strong> license:</p>
      <pre><code>${key}</code></pre>
      <p>Add to your bot's <code>.env</code>:</p>
      <pre><code>LICENSE_KEY=${key}</code></pre>
      <p>Questions? Reply to this email.</p>
    `,
  });

  console.log(`[Email] Sent license to ${email}`);
}
```

---

## 💰 Pricing Strategy Tips

1. **Starter ($29)** — hook users with chatbot, low barrier to entry
2. **Trader ($79)** — jump for serious traders who want buy alerts
3. **Pro ($199)** — maximize revenue from enterprise users

**Alternative pricing:**
- Monthly: $3 / $8 / $20
- Lifetime: $99 / $199 / $399
- Usage-based: per 1000 messages, per 1000 DEX alerts, etc.

---

## 🔒 Security Notes

- **Keys should be random UUIDs** (not sequential) ✅
- **Keys should be long enough** (16+ chars) ✅
- **Stripe webhook must validate signature** ✅ (already in code)
- **Don't log full keys** (only last 4 chars) ✅
- **Keys file should be .gitignored** ✅
- **Rotate Stripe secret if compromised**
- **Consider rate-limiting** `/api/validate-license` endpoint

---

## 📊 Monitoring & Analytics (Future)

Track:
- Active licenses per tier
- Expiring soon (send renewal email)
- Most used modules
- Regional breakdown
- Revenue per tier

Dashboard could show:
```
┌─────────────────────────┐
│ Analytics               │
├─────────────────────────┤
│ Total Revenue: $2,847   │
│ Active Licenses: 12     │
│ Expiring (30d): 2       │
│                         │
│ Breakdown:              │
│ - Starter: 5 licenses   │
│ - Trader: 4 licenses    │
│ - Pro: 3 licenses       │
└─────────────────────────┘
```

---

## ✅ Summary

You now have:
- ✅ **Dashboard GUI** to set pricing & manage licenses
- ✅ **Stripe integration** for automatic license generation
- ✅ **License validation** (local + remote options)
- ✅ **Audit checklist** to test everything
- ✅ **Deployment guide** to launch

Next: Test locally, then deploy to Vercel + Stripe production keys.
