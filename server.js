// server.js
import fs from 'fs';
import path from 'path';
import express from 'express';
import Database from 'better-sqlite3';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// --- Open DB
const db = new Database(path.join(dataDir, 'data.db'));

// --- Create schema if missing
db.exec(`
CREATE TABLE IF NOT EXISTS bars (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  bar_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued','redeemed','void')) DEFAULT 'issued',
  nonce TEXT UNIQUE NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(bar_code) REFERENCES bars(code)
);
`);

// --- Seed a bar if empty (so you can test)
const barCount = db.prepare(`SELECT COUNT(*) AS c FROM bars`).get().c;
if (barCount === 0) {
  db.prepare(`INSERT INTO bars (id, code, name) VALUES (@id, @code, @name)`)
    .run({ id: cryptoRandom(), code: 'nav001', name: 'Bar Navigli' });
  console.log('Seeded default bar: nav001 (Bar Navigli)');
}

// --- Helpers
function cryptoRandom() {
  // simple random id
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Pretty link: /b/:code -> /?bar=code
app.get('/b/:code', (req, res) => {
  const code = req.params.code;
  const row = db.prepare(`SELECT 1 FROM bars WHERE code=? AND active=1`).get(code);
  if (!row) return res.status(404).send('Invalid bar code');
  res.redirect('/?bar=' + encodeURIComponent(code));
});

// --- API: create claim (guest presses "Get Free Drink")
app.post('/api/claim', (req, res) => {
  try {
    const { bar, source } = req.body;
    if (!bar) return res.status(400).json({ error: 'missing_bar' });
    const ok = db.prepare(`SELECT 1 FROM bars WHERE code=? AND active=1`).get(bar);
    if (!ok) return res.status(400).json({ error: 'unknown_bar' });

    const nonce = cryptoRandom();
    db.prepare(`
      INSERT INTO claims (id, bar_code, status, nonce, source)
      VALUES (@id, @bar_code, 'issued', @nonce, @source)
    `).run({
      id: cryptoRandom(),
      bar_code: bar,
      nonce,
      source: source || null
    });

    res.json({ ok: true, nonce });
  } catch (e) {
    console.error('claim_failed', e);
    res.status(500).json({ error: 'claim_failed' });
  }
});

// --- API: redeem (staff confirms on their bar)
app.post('/api/redeem', (req, res) => {
  try {
    const { nonce, staffBar } = req.body;
    if (!nonce || !staffBar) return res.status(400).json({ error: 'missing_params' });

    const claim = db.prepare(`SELECT bar_code, status, created_at FROM claims WHERE nonce=?`).get(nonce);
    if (!claim) return res.status(404).json({ error: 'not_found' });
    if (claim.status === 'redeemed') return res.status(409).json({ error: 'already_redeemed' });
    if (claim.bar_code !== staffBar) return res.status(403).json({ error: 'wrong_bar' });

    // Optional expiry check: 24h
    // if (new Date(claim.created_at) < new Date(Date.now() - 24*60*60*1000)) {
    //   return res.status(410).json({ error: 'expired' });
    // }

    db.prepare(`UPDATE claims SET status='redeemed' WHERE nonce=?`).run(nonce);
    res.json({ ok: true });
  } catch (e) {
    console.error('redeem_failed', e);
    res.status(500).json({ error: 'redeem_failed' });
  }
});

// --- API: stats (overall or per bar via ?bar=code)
app.get('/api/stats', (req, res) => {
  const { bar } = req.query;
  let where = '';
  let arg = [];
  if (bar) { where = 'WHERE bar_code=?'; arg = [bar]; }

  const totals = db.prepare(`
    SELECT 
      COUNT(*) AS claims,
      SUM(CASE WHEN status='redeemed' THEN 1 ELSE 0 END) AS redemptions
    FROM claims
    ${where}
  `).get(...arg);

  res.json(totals || { claims: 0, redemptions: 0 });
});

// --- API: list bars
app.get('/api/bars', (_req, res) => {
  const rows = db.prepare(`SELECT code, name, active, created_at FROM bars ORDER BY created_at DESC`).all();
  res.json(rows);
});

// --- API: create bar (used by admin.html form)
app.post('/api/bars', (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'missing_fields' });
    db.prepare(`INSERT INTO bars (id, code, name, active) VALUES (@id, @code, @name, 1)`)
      .run({ id: cryptoRandom(), code, name });
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes('UNIQUE')) return res.status(409).json({ error: 'code_taken' });
    console.error('create_bar_failed', e);
    res.status(500).json({ error: 'create_bar_failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on :${PORT}`);
});
