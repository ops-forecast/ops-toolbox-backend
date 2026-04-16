const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeKey(key) {
  // Only allow alphanumeric, dash, underscore
  return /^[a-zA-Z0-9_-]+$/.test(key);
}

function filePath(key) {
  return path.join(DATA_DIR, `${key}.json`);
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ops-toolbox-server' });
});

// Save a value by key
app.post('/save/:key', (req, res) => {
  const { key } = req.params;
  if (!safeKey(key)) return res.status(400).json({ error: 'Invalid key' });
  try {
    const payload = JSON.stringify({ value: req.body.value, updatedAt: new Date().toISOString() });
    fs.writeFileSync(filePath(key), payload, 'utf8');
    res.json({ ok: true, key, updatedAt: JSON.parse(payload).updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Load a value by key
app.get('/load/:key', (req, res) => {
  const { key } = req.params;
  if (!safeKey(key)) return res.status(400).json({ error: 'Invalid key' });
  const fp = filePath(key);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    res.json({ ok: true, key, value: raw.value, updatedAt: raw.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a key
app.delete('/delete/:key', (req, res) => {
  const { key } = req.params;
  if (!safeKey(key)) return res.status(400).json({ error: 'Invalid key' });
  const fp = filePath(key);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try {
    fs.unlinkSync(fp);
    res.json({ ok: true, key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List all keys
app.get('/keys', (req, res) => {
  try {
    const keys = fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
    res.json({ ok: true, keys });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Debug ─────────────────────────────────────────────────────────────────────
app.get('/debug/shopify', (req, res) => {
  const cfgPath = filePath('shopify-config');
  const hasFile = fs.existsSync(cfgPath);
  const hasEnvToken = !!process.env.SHOPIFY_ACCESS_TOKEN;
  const hasEnvStore = !!process.env.SHOPIFY_STORE;
  const envStore = process.env.SHOPIFY_STORE || null;
  const tokenPrefix = process.env.SHOPIFY_ACCESS_TOKEN ? process.env.SHOPIFY_ACCESS_TOKEN.substring(0, 10) + '...' : null;
  res.json({ hasFile, hasEnvToken, hasEnvStore, envStore, tokenPrefix });
});

// ── Shopify proxy ─────────────────────────────────────────────────────────────
// Routes GraphQL requests to Shopify server-side, bypassing CORS entirely.
// Reads store/token from saved config so the browser never needs them after setup.

app.post('/shopify/graphql', async (req, res) => {
  try {
    // Try saved config file first, fall back to environment variables
    let store, token, apiVersion = '2025-01';
    const cfgPath = filePath('shopify-config');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).value;
      store = cfg.store; token = cfg.token; apiVersion = cfg.apiVersion || apiVersion;
    } else if (process.env.SHOPIFY_ACCESS_TOKEN && process.env.SHOPIFY_STORE) {
      store = process.env.SHOPIFY_STORE;
      token = process.env.SHOPIFY_ACCESS_TOKEN;
    } else {
      return res.status(401).json({ error: 'Shopify not configured. Please set up your store credentials in Settings.' });
    }

    const { query, variables } = req.body;

    const response = await fetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      return res.status(response.status).json({ error: `Shopify returned ${response.status}`, detail: errBody });
    }

    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ── Claude proxy ──────────────────────────────────────────────────────────
app.post('/claude', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Ops Toolbox server running on port ${PORT}`);
});
