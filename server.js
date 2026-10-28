require('dotenv').config();
const express = require('express');
const path = require('path');
const { createLimiter } = require('./rate-limit');
const { registerBilling } = require('./billing');

const app = express();
// nginx sits in front and sets X-Forwarded-For; without this every visitor
// would look like 127.0.0.1 and share one rate-limit bucket.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Public runtime config for the browser Supabase client.
// The anon key is designed to be public (row level security enforces access), so
// exposing it here is safe and mirrors how the sibling ozma apps are built.
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// Same token-forwarding helpers as the color app: calls are made with the
// user's own Supabase token, so this server holds no admin key.
class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.body = { error: code, ...extra };
  }
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'login_required');
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new HttpError(401, 'login_required');
  return { token, user: await r.json() };
}

// Google Play coin packs (see billing.js). Valid product ids come from the
// public coin_products table so a price/pack change needs no redeploy.
let productCache = { ids: [], at: 0 };
async function activeProductIds() {
  if (Date.now() - productCache.at < 60 * 1000 && productCache.ids.length) return productCache.ids;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/coin_products?active=eq.true&select=product_id`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY },
  });
  if (!r.ok) return productCache.ids;
  productCache = { ids: (await r.json()).map((p) => p.product_id), at: Date.now() };
  return productCache.ids;
}
registerBilling(app, {
  packageName: 'com.ozma.numerologytarot',
  requireUser, HttpError,
  limiter: createLimiter(),
  products: activeProductIds,
});

// dotfiles: 'allow' is needed so /.well-known/assetlinks.json (Digital
// Asset Links, for TWA verification) actually gets served — express.static
// ignores dot-prefixed paths by default.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'allow' }));

app.listen(PORT, () => {
  console.log(`Numerology Tarot App running at http://localhost:${PORT}`);
});
