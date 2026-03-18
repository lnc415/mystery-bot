# Mystery Bot — 30-Minute Quick Start

## ⚡ Step 1: Install Bot (5 min)

```bash
cd Z:/Claude Crypto/mystery-bot
npm install
cp .env.example .env
```

Edit `.env`:
```bash
DISCORD_TOKEN=paste_your_token_here
DISCORD_CLIENT_ID=paste_your_client_id_here
```

Register commands:
```bash
npm run register
```

Start bot:
```bash
npm start
```

✅ Bot should say: `🤖 [YourBotName] online`

---

## ⚡ Step 2: Install Dashboard (5 min)

```bash
cd Z:/Claude Crypto/mystery-bot/dashboard
npm install
cp .env.example .env
npm start
```

✅ Open browser: **http://localhost:3001**
✅ Login with: `change-me`

---

## ⚡ Step 3: Test Licensing (10 min)

**In Dashboard:**
1. Click **Licenses** tab
2. Click **Generate License (Manual)**
3. Set Tier: `pro`
4. Set Label: `test@example.com`
5. Click **Generate Key**
6. Copy the key that appears (e.g., `MBOT-abcd-efgh-ijkl-mnop`)

**Test Free Bot (No License):**
1. Stop bot (`Ctrl+C`)
2. Edit `.env`: delete or leave `LICENSE_KEY=` empty
3. Start bot again
4. In Discord: `/status` → should show ⚫ Chatbot, ⚫ Buy Bot, ⚫ Sell Bot (disabled)

**Test Paid Bot (With License):**
1. Stop bot
2. Edit `.env`: `LICENSE_KEY=MBOT-abcd-efgh-ijkl-mnop` (your generated key)
3. Start bot again
4. In Discord: `/status` → should show 🟢 all modules enabled

✅ **If this works, licensing system is working!**

---

## ⚡ Step 4: Connect Stripe (Optional, 10 min)

### Get Stripe Keys

1. Go to https://stripe.com → Sign up (or login)
2. Go to Developers → API Keys
3. Copy **Publishable key** (starts with `pk_`)
4. Copy **Secret key** (starts with `sk_`)

### Create Webhook

1. Stripe Dashboard → Developers → Webhooks
2. Click **Add Endpoint**
3. URL: `http://localhost:3001/api/webhooks/stripe`
4. Events: `checkout.session.completed`
5. Click **Create Endpoint**
6. Click the webhook → get **Signing secret** (starts with `whsec_`)

### Add to Dashboard

Edit `dashboard/.env`:
```bash
STRIPE_PUBLIC_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
DOMAIN=http://localhost:3001
```

Restart dashboard:
```bash
cd dashboard && npm start
```

### Test Payment

In Dashboard → **Licenses** tab:

```bash
# Option 1: Continue generating keys manually

# Option 2: Test Stripe locally with Stripe CLI
stripe listen --forward-to localhost:3001/api/webhooks/stripe
stripe trigger payment_intent.succeeded
```

✅ **Check Licenses table → new key should appear!**

---

## ✅ Verification Checklist

- [ ] Bot starts without errors
- [ ] Bot responds to `/help` command
- [ ] Bot responds to `/status` command
- [ ] Bot responds to `/gif` command
- [ ] Dashboard login works (password: `change-me`)
- [ ] Can generate license keys in dashboard
- [ ] Free bot (no LICENSE_KEY) → only GIF works
- [ ] Paid bot (with LICENSE_KEY) → all features work
- [ ] Stripe webhook configured (if using payments)
- [ ] No keys in git history (`git log --all -S "MBOT-"` = nothing)

---

## 🚨 Common Issues & Fixes

### Bot won't start
```
Error: Missing required env var: DISCORD_TOKEN
```
→ Check `.env` has your Discord token

### Dashboard won't load
```
Error: Port 3001 is already in use
```
→ Try different port: `DASHBOARD_PORT=3002 npm start`

### License not unlocking features
```
[License] Module "chatbot" not unlocked
```
→ License key doesn't include that module. Generate new key with correct tier.

### Stripe webhook not firing
```
[Stripe] Webhook error: Could not construct event
```
→ Check webhook secret is correct in `.env`

### Can't connect to bot
```
Discord bot is offline
```
→ Check DISCORD_TOKEN is valid + bot has permissions in server

---

## 🎯 Next: Deployment (After Testing)

When everything works locally:

1. **Push to GitHub** (if using git)
2. **Deploy bot** → Replit / Railway / VCS
3. **Deploy dashboard** → Vercel / Railway
4. **Set custom domain** (optional)
5. **Switch to Stripe production keys**

See `SETUP.md` for detailed deployment instructions.

---

## 📞 Need Help?

- **Bot issues?** → Check DISCORD_TOKEN, intents, permissions
- **Dashboard issues?** → Check port isn't in use, .env has DASHBOARD_PORT
- **License issues?** → Check key format (MBOT-...), expiration, tier modules
- **Stripe issues?** → Check webhook secret, test with Stripe CLI first

---

## 🏁 You're Ready!

You now have a fully-functional, secure, sellable Discord bot framework.

**Next steps:**
1. Test locally (this checklist)
2. Deploy (SETUP.md)
3. Launch (build checkout page)
4. Profit! 🚀

Good luck! 🎉
