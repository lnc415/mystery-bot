# Mystery Bot — Complete Setup Guide

## ⚡ Quick Start (5 minutes)

### 1. Bot Installation

```bash
cd mystery-bot
npm install
cp .env.example .env
```

Edit `.env`:
```bash
DISCORD_TOKEN=your_token_here
DISCORD_CLIENT_ID=your_client_id_here
```

Register commands:
```bash
npm run register
```

Start the bot:
```bash
npm start
```

### 2. Dashboard Installation

```bash
cd dashboard
npm install
cp .env.example .env
```

Start the dashboard:
```bash
npm start
```

Open: **http://localhost:3001**
- Login with: `change-me` (default password)

---

## 🏗️ Architecture Overview

```
mystery-bot/
├── src/                    # Discord bot
│   ├── modules/
│   │   ├── chatbot/       → AI chat (Groq/OpenAI/Anthropic)
│   │   ├── buybot/        → Cardano DEX monitoring
│   │   └── gifbot/        → Random GIF responder
│   ├── license/           → License key validation
│   └── commands/          → Slash commands (/help, /status)
│
└── dashboard/             # Owner control panel
    ├── server.js          → Express backend
    ├── public/
    │   └── index.html     → React-free UI (vanilla JS)
    └── data/
        ├── config.json    → Dashboard settings
        ├── pricing.json   → Tier definitions
        └── licenses.json  → Active license keys
```

---

## 💰 Pricing & Licensing System

### How It Works

1. **You set pricing tiers** in the dashboard
   - Starter: $29 (GIF + Chatbot)
   - Trader: $79 (Buy/Sell alerts)
   - Pro: $199 (Everything)

2. **Customers buy on Stripe** (auto-setup coming)

3. **License key auto-generated** via webhook

4. **Customer enters key in their `.env`**:
   ```
   LICENSE_KEY=MBOT-XXXX-XXXX-XXXX-XXXX
   ```

5. **Features unlock automatically** when bot starts

### Generate Keys Manually

In dashboard, go to **Licenses** tab → **Generate License**

Or via CLI:
```bash
npm run keygen pro "customer@example.com" 365
```

---

## 🔌 Stripe Integration (Auto-Licensing)

### Setup (10 minutes)

1. **Create Stripe account** → https://stripe.com
2. **Get API keys** from https://dashboard.stripe.com/apikeys
3. **Create webhook endpoint**:
   - Endpoint URL: `https://your-domain.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`
   - Get webhook secret: copy from webhook settings

4. **Add to dashboard `.env`**:
   ```bash
   STRIPE_PUBLIC_KEY=pk_live_...
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   DOMAIN=https://your-domain.com
   ```

5. **Restart dashboard** → Settings → Stripe config auto-fills

### Test Flow

1. Customer visits your checkout page (you build this)
2. POST to `/api/checkout` with `{tier, email}`
3. Stripe checkout opens
4. On success, webhook fires → license auto-generated
5. Customer gets key via email (optional enhancement)

---

## ✅ Audit Checklist

### Bot Configuration ✓

- [ ] **Env vars set correctly**
  - `DISCORD_TOKEN` present
  - `DISCORD_CLIENT_ID` matches your bot
  - Optional: `DISCORD_GUILD_ID` (for testing)

- [ ] **Modules enabled/disabled as expected**
  - `ENABLE_GIFBOT=true` (free, always works)
  - `ENABLE_CHATBOT=true` → requires `GROQ_API_KEY` + `AI_PROVIDER=groq`
  - `ENABLE_BUYBOT=true` → requires `BLOCKFROST_PROJECT_ID` + token config

- [ ] **License enforcement**
  - Bot with no `LICENSE_KEY` → only GIF bot works
  - Bot with paid key → all modules unlock
  - Expired key → reverts to free modules

### Dashboard Functionality ✓

- [ ] **Login works**
  - Default password: `change-me`
  - Change it in Settings tab
  - Token persists until Logout

- [ ] **Pricing tab**
  - View default tiers (Starter / Trader / Pro)
  - Edit a tier → price updates instantly
  - Add new tier → appears in grid

- [ ] **Licenses tab**
  - Generate key manually → shows in table
  - Copy key → pastes correctly
  - Delete key → removes instantly
  - Status shows "active" / "expiring" / "expired"

- [ ] **Settings tab**
  - Change owner password → works on next login
  - Stripe config saved → enables auto-licensing

### Stripe Integration ✓

- [ ] **Webhook secret set** in dashboard Settings
- [ ] **Test checkout**:
  ```bash
  curl -X POST http://localhost:3001/api/checkout \
    -H "Content-Type: application/json" \
    -d '{"tier":"starter","email":"test@example.com"}'
  ```
- [ ] **Mock webhook test** (use Stripe CLI):
  ```bash
  stripe listen --forward-to localhost:3001/api/webhooks/stripe
  stripe trigger payment_intent.succeeded
  ```
- [ ] **License auto-generated** after fake payment

### User Experience ✓

- [ ] **Dashboard is intuitive**
  - Tabs make sense (Pricing / Licenses / Settings)
  - Buttons are clear (Generate, Save, Delete)
  - Colors are readable (gold, teal on dark background)
  - Mobile-friendly (responsive grid)

- [ ] **Error handling**
  - Invalid password → shows error, doesn't crash
  - Missing env vars → bot logs warnings, doesn't crash
  - Expired license → bot gracefully reverts to free tier
  - Bad API calls → dashboard shows alert

- [ ] **Documentation clarity**
  - Setup guide doesn't require reading code
  - Dashboard hints explain what each setting does
  - Error messages point to fixes

---

## 🧪 Test Scenarios

### Scenario 1: Free Bot (No License)

```bash
ENABLE_GIFBOT=true
ENABLE_CHATBOT=false
ENABLE_BUYBOT=false
LICENSE_KEY=           # empty
```

Expected:
- ✅ `/gif` command works
- ✅ `/status` shows "⚫ Chatbot Disabled"
- ✅ No buy alerts

### Scenario 2: Starter License

```bash
ENABLE_CHATBOT=true
ENABLE_BUYBOT=false
LICENSE_KEY=MBOT-1234-5678-9012-3456
```

Expected:
- ✅ `/gif` works
- ✅ ChatBot responds to @mentions
- ✅ `/status` shows chatbot active
- ❌ `/status` shows buybot disabled

### Scenario 3: Expired License

```bash
LICENSE_KEY=MBOT-XXXX-XXXX-XXXX-XXXX  # expired_date < now
```

Expected:
- ✅ `/gif` works (free module)
- ❌ Chatbot disabled (license expired)
- Logs: `[License] Expired key`

### Scenario 4: Stripe Webhook

1. **Create test product**: $29 in Stripe
2. **Generate checkout session** via `/api/checkout`
3. **Pay with test card**: `4242 4242 4242 4242`
4. **Check licenses table**: new key appears
5. **Verify key in `/api/licenses`**: has correct tier

---

## 🚀 Deployment

### Deploy Bot (Replit / Railway / VPS)

1. Push to GitHub
2. Connect GitHub to Replit/Railway
3. Set env vars in platform dashboard
4. Deploy runs `npm start`

### Deploy Dashboard (Vercel / Railway)

1. Push `dashboard/` folder
2. Set env vars
3. Deploy
4. Share URL with customers

### Domain Setup (Custom domain)

1. Register domain (GoDaddy, Namecheap, etc.)
2. Point to your deployed dashboard
3. Update `DOMAIN=https://yourdomain.com` in dashboard `.env`
4. Update Stripe webhook URL to `https://yourdomain.com/api/webhooks/stripe`

---

## 🐛 Troubleshooting

### Bot won't start
```
Error: Missing required env var: DISCORD_TOKEN
```
→ Check `.env` exists and has `DISCORD_TOKEN=...`

### Chatbot not responding
```
[Chatbot] Error: 401 Unauthorized
```
→ Check `GROQ_API_KEY` or `AI_PROVIDER=groq`

### Dashboard login fails
```
Not authenticated
```
→ Password is case-sensitive, default is `change-me`

### Stripe webhook not firing
```
[Stripe] Webhook error: Could not construct event
```
→ Check `STRIPE_WEBHOOK_SECRET` is correct in `.env`

### License not unlocking features
```
[License] Module "chatbot" not unlocked
```
→ License key doesn't include that module. Regenerate with correct tier.

---

## 📚 Next Steps

1. **Add Checkout Page** — build a simple page with Stripe Elements
2. **Email Notifications** — send license key to customer email
3. **Advanced Analytics** — track which licenses are active
4. **Multi-Bot Support** — deploy many bots with shared licensing backend
5. **Affiliate System** — allow partners to resell with commission

---

## Support

- **Bot Issues**: Check Discord intents, token permissions
- **Dashboard Issues**: Browser console shows API errors
- **Stripe Issues**: Test webhook with Stripe CLI locally first

Happy selling! 🚀
