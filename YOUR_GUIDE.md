# Mystery Bot — Your Personal Quick Guide

## 📝 What You Need to Know

This is a **sellable Discord bot** that makes money by:
1. You set prices (Starter $29, Trader $79, Pro $199)
2. Customer buys → gets a license key
3. They add key to their bot's settings
4. Their bot unlocks paid features

---

## 🔑 Services You Need to Sign Up For

### Required ✅
1. **Discord Developer Portal** (free)
   - Where: https://discord.com/developers/applications
   - Why: Get your bot token
   - Takes: 5 minutes
   - Cost: FREE

### Optional but Recommended 🎯
2. **Stripe** (to accept payments)
   - Where: https://stripe.com
   - Why: Auto-generate keys when customers buy
   - Takes: 10 minutes to set up
   - Cost: FREE to set up, takes 2.9% + $0.30 per transaction when you make sales

### That's It!
You don't need anything else. No hosting fees (deploy free to Vercel), no database (uses JSON files).

---

## 💻 Where to Run the Code

You'll use **Command Prompt (CMD)** or **PowerShell** on your Windows machine.

### Opening Command Prompt:
1. Press `Win + R`
2. Type: `cmd`
3. Press Enter

### Then navigate to the bot folder:
```cmd
cd Z:\Claude Crypto\mystery-bot
```

### Key commands you'll use:

**First time setup:**
```cmd
npm install
```

**Start the bot:**
```cmd
npm start
```

**Start the dashboard:**
```cmd
cd dashboard
npm start
```

**Generate a license key manually:**
```cmd
npm run keygen pro "customer@example.com" 365
```

That's all you need to know for running code. Everything runs in the same Command Prompt window.

---

## 🎮 How to Use the Dashboard

### Starting the Dashboard

1. Open Command Prompt (Win + R → `cmd`)
2. Navigate: `cd Z:\Claude Crypto\mystery-bot\dashboard`
3. Start it: `npm start`
4. Open browser: **http://localhost:3001**
5. Login: `change-me` (password)

### What You See

You get 3 tabs:

#### Tab 1: Pricing 💰
**This is where you make money**

- See your individual modules:
  - GIF Bot: $10
  - Chatbot: $50
  - Buy Bot: $25
  - Sell Bot: $25
  - Liquidity Monitor: $25
  - **Full Package: $75** (all 5, saves customers $35)

- Want to change prices? Click "Edit" on a module, change the price, click Save
- Want to add a module? Fill in the form at bottom, click Save

**Example:** Change GIF Bot from $10 to $15
1. Click "Edit" on GIF Bot card
2. Change "$10" to "$15"
3. Click "Save Tier"
4. Done ✅

#### Tab 2: Licenses 🔑
**This is where you manage customer keys**

**Generate a key manually (for testing or special customers):**
1. Fill in: Tier (pro), Label (their email), Days (365)
2. Click "Generate Key"
3. You get a key like: `MBOT-abc1-def2-ghi3-jkl4`
4. Copy it and send to customer

**View all active keys:**
- Shows customer email, tier, status (active/expiring/expired)
- Want to cancel someone? Click "Delete" button

#### Tab 3: Settings ⚙️
**Security and payments**

- **Change password:** Type new password, click "Update Password"
- **Connect Stripe:** (Only if you want automatic payments)
  - Paste your Stripe keys
  - Click "Save Stripe Config"
  - Then customers can buy automatically

---

## 💳 The Complete Sales Flow

### Scenario: Someone Wants to Buy Your Bot

**Example 1: Customer Buys Just Buy Bot ($25)**

**Step 1: Customer Finds Your Bot**
- They discover your bot
- They want the "Buy Bot" module ($25)

**Step 2: They Click Your Checkout**
- They go to your website with Stripe checkout
- They select "Buy Bot" ($25)
- They enter email: `their-email@gmail.com`
- They pay with credit card

**Step 3: Automatic Magic ✨**
- Payment verified
- Stripe webhook fires
- License key generated: `MBOT-xyz1-abc2-def3-ghi4`
- Key includes ONLY "buybot" module
- Email: "Your Buy Bot license: MBOT-xyz1-abc2-def3-ghi4"

**Step 4: Customer Uses the Key**
- They create their own Discord bot
- Edit `.env`: `LICENSE_KEY=MBOT-xyz1-abc2-def3-ghi4`
- Run: `npm start`
- Bot starts → validates key → unlocks Buy Bot ✅

**Step 5: What Works / What Doesn't**
- ✅ `/gif` works (GIF Bot — free tier always available)
- ✅ Buy alerts post to Discord (they paid for this)
- ❌ `/gif` (GIF Bot) only shows placeholder (didn't buy it)
- ❌ Chatbot disabled (didn't buy it)
- ❌ Sell alerts (didn't buy it)

---

**Example 2: Customer Buys Full Package ($75)**

Same flow, but:
- They pay $75 for "Full Package"
- Key includes ALL modules: gifbot, chatbot, buybot, sellbot, liquidity
- Everything unlocks ✅

---

**Example 3: Customer Buys Multiple Separate Modules**

- Monday: Buys Buy Bot ($25) → gets `KEY-123`
- Friday: Buys Chatbot ($50) → gets `KEY-456`
- Problem: Can only use one key at a time

**Solution:** They should buy Full Package ($75) instead (saves $0, but easier to manage)

---

## 🧪 Testing This Yourself (No Real Payment)

### Test 1: Generate a Test Key

```cmd
cd Z:\Claude Crypto\mystery-bot
npm run keygen bundle "test@example.com" 365
```

Or for individual modules:
```cmd
npm run keygen gifbot "test@example.com" 365
npm run keygen chatbot "test@example.com" 365
npm run keygen buybot "test@example.com" 365
```

Output:
```
✅ License key generated:
   Key:     MBOT-abcd-1234-5678-efgh
   Module:  Full Package
   Price:   $75
   Label:   test@example.com
   Modules: gifbot, chatbot, buybot, sellbot, liquidity
   Expires: March 18, 2027
```

### Test 2: Use That Key in a Bot

1. **Start the bot with NO key:**
   ```cmd
   cd Z:\Claude Crypto\mystery-bot
   npm start
   ```
   In Discord: `/status` → only GIF bot is enabled ⚫

2. **Stop the bot (Ctrl+C)**

3. **Edit .env file:**
   ```
   LICENSE_KEY=MBOT-abcd-1234-5678-efgh
   ```

4. **Start the bot again:**
   ```cmd
   npm start
   ```
   In Discord: `/status` → ALL features enabled 🟢

### Test 3: Test With Stripe (Optional)

If you want to test actual payment flow:
1. Sign up for Stripe
2. Get test keys (starts with `pk_test_` and `sk_test_`)
3. Add to dashboard `.env`
4. Use Stripe's test card: `4242 4242 4242 4242`
5. Payment goes through → key auto-generates

---

## 🚀 Real-World Timeline

### Day 1 (Today)
- [ ] Sign up for Discord Developer Portal (get bot token)
- [ ] Run `npm install` in mystery-bot folder
- [ ] Test the bot locally
- [ ] Test the dashboard

### Day 2
- [ ] Sign up for Stripe (if you want auto-licensing)
- [ ] Connect Stripe to dashboard
- [ ] Test with a fake payment

### Day 3+
- [ ] Deploy bot to Vercel/Railway (makes it 24/7 online)
- [ ] Deploy dashboard to Vercel (makes it accessible)
- [ ] Build a simple checkout page (even just Google Form → manual key)
- [ ] Start selling!

---

## ❓ FAQ

**Q: How do I make the bot public so customers can use it?**
A: Deploy it to Vercel or Railway (free). Instructions in SETUP.md.

**Q: Can customers copy/steal the bot code?**
A: Yes, but keys unlock features. They can't use features without a valid key from you.

**Q: What if someone shares their key with a friend?**
A: It works for them too. If you want to prevent this, you can bind keys to Discord server IDs (optional, see SECURITY.md).

**Q: Do I have to use Stripe?**
A: No. You can just generate keys manually in dashboard and email them to customers. Stripe just automates it.

**Q: Can I change prices after I start selling?**
A: Yes, anytime in the dashboard. New keys use new prices.

**Q: What if a customer's key expires?**
A: They stop getting features. You can generate a new key or delete the old one and issue a new one.

**Q: How much money can I make?**
A: If you get 10 customers on Pro ($199), that's $1,990/year. Stripe takes 2.9% + $0.30, so you get ~$1,920.

---

## 🎯 Quick Reference

### Commands You'll Actually Use

**First time:**
```cmd
cd Z:\Claude Crypto\mystery-bot
npm install
```

**Start bot (keep this window open):**
```cmd
npm start
```

**Start dashboard (new Command Prompt window):**
```cmd
cd Z:\Claude Crypto\mystery-bot\dashboard
npm start
```

**Generate a key:**
```cmd
npm run keygen pro "customer@email.com" 365
```

That's it. You only need these 4 commands.

---

## 🎉 You're Ready!

This whole thing works. Just:
1. Get your Discord bot token
2. Run the bot locally to test
3. Sign up for Stripe when you're ready for real customers
4. Deploy somewhere (free options exist)
5. Start selling!

Any questions? Check SECURITY.md for "how can someone cheat?" or PRICING_GUIDE.md for "how do payments work?"
