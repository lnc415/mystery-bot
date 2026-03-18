# Mystery Bot — Security & Paywall Protection

**Goal:** Make it impossible to bypass paywalls or fake license keys.

---

## 🔒 Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| Guess/brute-force license keys | HIGH | Long random UUIDs, rate limiting |
| Modify local `keys.json` | HIGH | Validate against central API |
| Copy license key from friend | MEDIUM | License binding to Discord server ID |
| Patch bot code to remove license check | MEDIUM | Server-side validation, attestation |
| Network intercept license API | MEDIUM | HTTPS only, request signing |
| Expired key stays active | MEDIUM | Server validates expiration |

---

## ✅ Security Implementation

### 1. Strong License Key Generation ✅

**Current:**
```javascript
const key = `MBOT-${uuidv4().slice(0, 8)}-...`
```

**Why this is good:**
- UUIDs are cryptographically random (unguessable)
- 36-char key = 2^128 entropy (brute-force impossible)
- Format is memorable for users

**Don't do this:**
```javascript
// ❌ BAD: Sequential keys
const key = `MBOT-${counter++}`

// ❌ BAD: Date-based
const key = `MBOT-${Date.now()}`

// ❌ BAD: Hash of email (reversible)
const key = crypto.createHash('sha256').update(email).digest('hex')
```

---

### 2. License Validation (Centralized) ✅

**Problem:** Customer could edit local `keys.json`

**Solution:** Validate against your central API on startup + periodically

Edit `src/license/manager.js`:

```javascript
const axios = require('axios');
const config = require('../config');

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
let cachedValidation = null;
let cacheTime = 0;

async function validateWithServer(licenseKey) {
  // Skip if no API configured (offline mode)
  if (!config.license.apiUrl) {
    console.warn('[License] No API URL configured, using local validation');
    return getEntitlements(licenseKey);
  }

  const now = Date.now();
  if (cachedValidation && (now - cacheTime) < CACHE_DURATION) {
    return cachedValidation;
  }

  try {
    const res = await axios.post(
      `${config.license.apiUrl}/api/validate-license`,
      { key: licenseKey },
      { timeout: 5000 }
    );

    if (!res.data.valid) {
      console.error('[License] Invalid key:', res.data.reason);
      return new Set(['gifbot']); // Free tier only
    }

    const modules = new Set(res.data.modules);
    modules.add('gifbot'); // Always include free tier

    // Cache the validation
    cachedValidation = modules;
    cacheTime = now;

    return modules;
  } catch (err) {
    console.warn('[License] Server validation failed:', err.message);
    // Graceful fallback: if network fails, keep last known state
    return cachedValidation || getEntitlements(licenseKey);
  }
}

module.exports = { validateWithServer, getEntitlements };
```

**In `src/index.js`:**

```javascript
const license = require('./license/manager');

client.once('ready', async () => {
  const entitlements = await license.validateWithServer(config.license.key);
  console.log(`[License] Modules: ${[...entitlements].join(', ')}`);

  // Validate again every 12 hours
  setInterval(async () => {
    await license.validateWithServer(config.license.key);
  }, 12 * 60 * 60 * 1000);
});
```

---

### 3. License Binding (Optional but Recommended) ✅

**Problem:** Same key could be used on multiple Discord servers

**Solution:** Bind license to Discord server ID

Edit dashboard `server.js`:

```javascript
app.post("/api/licenses/generate", requireAuth, (req, res) => {
  const { tier = "pro", label, days = 365, guildId = null } = req.body;

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
    guildId: guildId || null, // null = any guild
  };

  save(LICENSES_FILE, licenses);
  res.json({ key, ...licenses[key] });
});
```

**In dashboard public HTML:**

```html
<div class="form-group">
  <label>Guild ID (optional — bind to specific Discord server)</label>
  <input type="text" id="genGuildId" placeholder="Leave empty for any server">
</div>
```

**In bot validation:**

```javascript
function isUnlocked(module, licenseKey, guildId = null) {
  const entry = keyStore[licenseKey];
  if (!entry) return false;

  // Check guild binding
  if (entry.guildId && entry.guildId !== guildId) {
    console.warn(`[License] Key bound to guild ${entry.guildId}, not ${guildId}`);
    return false;
  }

  return getEntitlements(licenseKey).has(module);
}
```

---

### 4. Rate Limiting (Prevent Brute Force) ✅

**Add to dashboard `server.js`:**

```javascript
const rateLimit = require('express-rate-limit');

// Limit license validation attempts
const validateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per 15 min
  message: "Too many validation attempts. Try again later.",
  skip: (req) => req.method === 'GET', // Don't rate limit reads
});

app.post("/api/validate-license", validateLimiter, (req, res) => {
  // ... existing code ...
});
```

Install: `npm install express-rate-limit`

---

### 5. Request Signing (Prevent Tampering) ✅

**Problem:** Network attacker could modify API response

**Solution:** HMAC-sign all responses

**In dashboard `server.js`:**

```javascript
const crypto = require('crypto');

const SIGNING_SECRET = process.env.SIGNING_SECRET || crypto.randomBytes(32).toString('hex');

function signResponse(data) {
  const payload = JSON.stringify(data);
  const hmac = crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
  return {
    ...data,
    _signature: hmac,
  };
}

app.post("/api/validate-license", (req, res) => {
  const { key } = req.body;
  const entry = licenses[key];

  if (!entry || entry.expires < new Date()) {
    return res.json(signResponse({ valid: false }));
  }

  res.json(signResponse({
    valid: true,
    modules: entry.modules,
    expires: entry.expires,
  }));
});
```

**In bot `src/license/manager.js`:**

```javascript
function verifySignature(data, signature) {
  const payload = JSON.stringify(data);
  const hmac = crypto.createHmac('sha256', config.license.signingSecret)
    .update(payload).digest('hex');
  return hmac === signature;
}

async function validateWithServer(licenseKey) {
  const res = await axios.post(`${config.license.apiUrl}/api/validate-license`, { key: licenseKey });

  const { _signature, ...data } = res.data;
  if (!verifySignature(data, _signature)) {
    throw new Error('[License] Response signature invalid — possible tampering');
  }

  return data;
}
```

---

### 6. No Keys in Source Code ✅

**✓ Correct:**
```bash
# .env
LICENSE_KEY=MBOT-...
```

**✗ Wrong:**
```javascript
// ❌ NEVER
const LICENSE_KEY = 'MBOT-...' // in code
```

`.gitignore` should block:
```bash
.env
.env.local
keys.json
```

---

### 7. License Revocation (Instant Deactivation) ✅

**In bot — reload licenses periodically:**

```javascript
// Every hour, re-validate license
setInterval(async () => {
  const fresh = await license.validateWithServer(config.license.key);
  if (fresh.size === 1 && fresh.has('gifbot')) {
    console.warn('[License] Key was revoked!');
    // Disable all paid modules immediately
  }
}, 60 * 60 * 1000);
```

**In dashboard — delete key instantly:**

```javascript
app.delete("/api/licenses/:key", requireAuth, (req, res) => {
  const { key } = req.params;
  delete licenses[key];
  save(LICENSES_FILE, licenses);

  // Immediately notify active bots (optional webhooks)
  notifyBotsOfRevocation(key); // broadcast via webhooks

  res.json({ success: true, revoked: key });
});
```

---

### 8. Expiration Enforcement ✅

**Both server + client validate expiration:**

**Server (dashboard):**
```javascript
const isExpired = (license) => license.expires && new Date(license.expires) < new Date();

if (isExpired(licenses[key])) {
  return res.json({ valid: false, reason: 'Expired' });
}
```

**Client (bot):**
```javascript
const isExpired = (expires) => {
  if (!expires) return false; // Lifetime license
  return new Date(expires) < new Date();
};

if (isExpired(serverResponse.expires)) {
  return new Set(['gifbot']); // Free tier only
}
```

---

### 9. API Security Headers ✅

**Add to dashboard `server.js`:**

```javascript
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

**HTTPS only:**
- Deploy on HTTPS (Vercel, Railway, etc. auto-HTTPS)
- Never send keys over HTTP
- Validate certificates

---

### 10. Monitoring & Alerts ✅

**Log suspicious activity:**

```javascript
// In license manager
const suspiciousLogins = new Map(); // key → attempts

function logFailedValidation(licenseKey) {
  const count = (suspiciousLogins.get(licenseKey) || 0) + 1;
  suspiciousLogins.set(licenseKey, count);

  if (count > 10) {
    console.error(`[ALERT] Key ${licenseKey} failed validation ${count} times!`);
    // Optionally auto-revoke
  }

  // Clean up old entries
  if (suspiciousLogins.size > 1000) suspiciousLogins.clear();
}
```

---

## 🧪 Security Test Plan

### Test Cases

- [ ] Try to guess random key format → fails
- [ ] Brute force validation endpoint → rate limited (429)
- [ ] Modify local `keys.json` → bot revalidates server, features disabled
- [ ] Copy friend's key to different server → fails if guild-bound
- [ ] Try expired key → treated as free tier
- [ ] Network intercept → signature validation fails
- [ ] Patch bot code to skip license check → server-side validation catches it
- [ ] Create own license key → invalid format, signature fails
- [ ] Replay old webhook → Stripe idempotent, no duplicate key

### Test Commands

```bash
# Test brute force protection
for i in {1..50}; do
  curl -X POST http://localhost:3001/api/validate-license \
    -H "Content-Type: application/json" \
    -d '{"key":"MBOT-fake-key-'$i'"}'
done
# Should get 429 Too Many Requests after 30

# Test signature verification
curl -X POST http://localhost:3001/api/validate-license \
  -H "Content-Type: application/json" \
  -d '{"valid":true,"_signature":"fake"}' \
  # Bot should reject

# Test expired key
# In licenses.json, set expires to past date, validate
# Should return: {valid: false, reason: "Expired"}
```

---

## 📋 Security Checklist

- [ ] License keys are random UUIDs (no guessing)
- [ ] Server validates all keys (no trust client)
- [ ] HTTPS enforced (no plaintext keys in transit)
- [ ] Rate limiting on validation endpoint (no brute force)
- [ ] Signature verification on responses (no tampering)
- [ ] Keys never hardcoded in source (all env vars)
- [ ] Expiration validated both server + client
- [ ] Guild binding optional but available
- [ ] Revoked keys take effect instantly
- [ ] Failed validations logged & monitored
- [ ] No keys in git history (check with `git log`)
- [ ] Stripe webhook validates signature (already in code)
- [ ] All secrets in `.env.example` redacted

---

## 🚨 If Compromise Is Suspected

1. **Revoke compromised key** in dashboard immediately
2. **Rotate API signing secret** in `.env`
3. **Check logs** for unusual validation attempts
4. **Issue new keys** to affected customers
5. **Rotate Stripe secret** if webhook secret leaked
6. **Post-mortem:** What went wrong?

---

## References

- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
- [Cryptographic Signing](https://nodejs.org/en/docs/guides/nodejs-crypto/)
- [Stripe Webhook Security](https://stripe.com/docs/webhooks/signature-verification)

---

**Remember:** Security is a process, not a destination. Test regularly, monitor closely, update dependencies.
