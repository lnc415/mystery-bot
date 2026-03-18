# Mystery Bot — Modular Discord Bot for Cardano & Midnight

> A sellable, feature-locked Discord bot with automatic license generation via Stripe.

**Features:**
- 🤖 **AI Chatbot** — Groq/OpenAI/Anthropic (swap providers easily)
- 📊 **Buy/Sell Alerts** — Monitor Cardano DEX via Blockfrost or TapTools
- 🎁 **GIF Bot** — Random GIFs (free tier)
- 💰 **Pricing Tiers** — Starter / Trader / Pro with automatic licensing
- 📲 **Owner Dashboard** — GUI to manage pricing, licenses, Stripe config
- 🔐 **License Management** — Keys auto-generate on payment, validate offline/online

---

## 🚀 Quick Start

### Bot

```bash
cd mystery-bot
npm install
cp .env.example .env
# Edit .env with your Discord token
npm run register
npm start
```

### Dashboard

```bash
cd dashboard
npm install
cp .env.example .env
npm start
# Opens: http://localhost:3001
# Login with: change-me
```

---

## 📁 Project Structure

```
mystery-bot/
├── src/
│   ├── index.js                 ← bot entry point
│   ├── config.js                ← single config from .env
│   ├── register-commands.js     ← setup slash commands
│   ├── modules/
│   │   ├── chatbot/             ← AI chat module
│   │   │   ├── index.js
│   │   │   └── providers/       ← groq.js, openai.js, anthropic.js
│   │   ├── buybot/              ← DEX monitoring
│   │   │   ├── index.js
│   │   │   └── sources/         ← blockfrost.js, taptools.js
│   │   └── gifbot/              ← GIF responder
│   ├── commands/
│   │   ├── help.js
│   │   └── status.js            ← shows active modules + license
│   └── license/
│       ├── manager.js           ← license validation logic
│       ├── keygen.js            ← generate keys (CLI)
│       └── keys.json            ← (gitignored) license store
│
├── dashboard/                    ← Owner control panel
│   ├── server.js                ← Express + Stripe webhook
│   ├── public/
│   │   └── index.html           ← Clean GUI (vanilla JS)
│   ├── data/                     ← JSON storage
│   │   ├── config.json
│   │   ├── pricing.json
│   │   └── licenses.json
│   └── package.json
│
├── SETUP.md                     ← Step-by-step guide + audit checklist
├── PRICING_GUIDE.md             ← Licensing architecture & Stripe setup
└── .gitignore
```

---

## 🎯 Pricing Tiers (Configurable)

| Tier | Price | Modules | Use Case |
|------|-------|---------|----------|
| **Starter** | $29 | GIF, Chatbot | Community engagement |
| **Trader** | $79 | GIF, Buy/Sell alerts | Active traders |
| **Pro** | $199 | Everything | Full featured |

✏️ Change anytime in Dashboard → Pricing tab

---

## 🔐 License System

### For You (Owner)

**Manual Key Generation:**
```bash
npm run keygen pro "customer@example.com" 365
# Output: MBOT-abcd-efgh-ijkl-mnop
```

**Automatic via Stripe:**
1. Customer buys on your Stripe checkout
2. Webhook fires → key auto-generated
3. Key stored in `dashboard/data/licenses.json`
4. Email sent to customer (optional)

**Dashboard Interface:**
- View all active licenses
- See expiration status
- Revoke keys instantly
- Generate manual keys

### For Customers

**Setup:**
1. Buy license from you
2. Get key: `MBOT-XXXX-XXXX-XXXX-XXXX`
3. Add to bot `.env`:
   ```bash
   LICENSE_KEY=MBOT-XXXX-XXXX-XXXX-XXXX
   ```
4. Run bot → features unlock automatically

---

## 💳 Stripe Integration

### Setup (5 min)

1. Create Stripe account: https://stripe.com
2. Get API keys from dashboard
3. Create webhook endpoint for `checkout.session.completed`
4. Add to dashboard `.env`:
   ```bash
   STRIPE_PUBLIC_KEY=pk_live_...
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

### Test Locally

```bash
# Install Stripe CLI
curl https://files.stripe.com/stripe-cli/install-latest/linux_x86_64.tar.gz | tar

# Listen for webhooks
stripe listen --forward-to localhost:3001/api/webhooks/stripe

# Test payment
stripe trigger payment_intent.succeeded

# Check dashboard → Licenses tab
# New key appears automatically ✅
```

---

## 🧪 Audit Checklist

### Configuration
- [ ] Bot token set in `.env`
- [ ] Discord client ID correct
- [ ] Modules enabled/disabled as intended
- [ ] AI provider configured (if using chatbot)
- [ ] Blockfrost/TapTools API key set (if using buybot)

### Dashboard
- [ ] Login works (`change-me` default)
- [ ] Pricing tiers display correctly
- [ ] Can edit tier prices and modules
- [ ] Generate license keys
- [ ] Delete expired keys
- [ ] Settings tab accessible

### Licensing
- [ ] Free bot (no LICENSE_KEY) → only GIF bot works
- [ ] Bot with Starter key → chatbot unlocked
- [ ] Bot with Trader key → buy/sell alerts unlocked
- [ ] Bot with Pro key → everything unlocked
- [ ] Expired key → features disabled gracefully

### Stripe (if enabled)
- [ ] Webhook secret saved
- [ ] Test checkout session creates
- [ ] Mock payment generates license automatically
- [ ] Email sent to customer (if configured)

### User Experience
- [ ] Dashboard is intuitive
- [ ] Error messages are helpful
- [ ] No crashes on invalid input
- [ ] Mobile-responsive design
- [ ] Color scheme is readable

See `SETUP.md` for detailed test scenarios.

---

## 🌐 Deployment

### Bot → Replit / Railway / VPS

```bash
git push origin main
# In platform: add env vars, deploy
# Platform runs: npm start
```

### Dashboard → Vercel / Railway

```bash
# Push dashboard/ folder
git push origin main
# In platform: add env vars
# Platform runs: npm start (port 3001)
```

### Domain Setup

1. Buy domain (GoDaddy, etc.)
2. Point to your deployed dashboard
3. Update `.env`:
   ```bash
   DOMAIN=https://yourdomain.com
   STRIPE_WEBHOOK_URL=https://yourdomain.com/api/webhooks/stripe
   ```

---

## 📚 Documentation

- **`SETUP.md`** — Installation, configuration, audit checklist
- **`PRICING_GUIDE.md`** — Licensing architecture, Stripe setup, security notes
- **`README.md`** (this file) — Overview

---

## 🎨 Customization

### Change Bot Persona

Edit `.env`:
```bash
BOT_NAME=Chuck
BOT_PERSONA="You are Chuck, a goofy kid detective..."
```

### Add Modules

1. Create new folder in `src/modules/newmodule/`
2. Export `register(client)` function
3. Load in `src/index.js`: `require("./modules/newmodule").register(client)`
4. Add to licensing tiers

### Change Pricing

Dashboard → Pricing tab → Edit tier → Save

---

## 🔧 API Reference

### Bot Commands

```
/help       → List available commands
/status     → Show active modules & license status
/gif        → Drop random GIF (free)
@bot        → Chat with AI (if enabled)
```

### Dashboard Endpoints

```
POST   /api/auth/login                  → Login
GET    /api/pricing                     → Get all tiers
POST   /api/pricing/:tier               → Update tier
GET    /api/licenses                    → List all keys
POST   /api/licenses/generate           → Generate key
DELETE /api/licenses/:key               → Revoke key
POST   /api/checkout                    → Create Stripe session
POST   /api/webhooks/stripe             → Stripe webhook
GET    /api/config                      → Dashboard config
POST   /api/settings                    → Update settings
```

---

## 🚨 Troubleshooting

| Issue | Fix |
|-------|-----|
| Bot won't start | Check `DISCORD_TOKEN` in `.env` |
| Chatbot 401 error | Verify `GROQ_API_KEY` or other AI provider key |
| Dashboard login fails | Password is case-sensitive, default is `change-me` |
| Stripe webhook not firing | Ensure `STRIPE_WEBHOOK_SECRET` is correct and webhook endpoint is accessible |
| License not unlocking | Key might be expired or typo in `LICENSE_KEY=` |

---

## 💡 Next Steps

1. **Test locally** (SETUP.md audit checklist)
2. **Deploy dashboard** to Vercel/Railway
3. **Set up Stripe** (test mode first)
4. **Build checkout page** (simple form + Stripe Elements)
5. **Launch! 🚀**

---

## 📝 License

This bot framework is open-source. Feel free to modify, resell, customize.

---

**Built for The $141 Mystery** 🕵️ **• Cardano + Midnight Network**
