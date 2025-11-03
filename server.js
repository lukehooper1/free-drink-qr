// server.js — Render + Postgres + static /public
// Requires: package.json with "express" and "pg", and env var DATABASE_URL

import express from 'express';
import { Pool } from 'pg';

const app = express();
const PORT = process.env.PORT || 3000;

// --- DB connection (use Internal Database URL from your Render Postgres)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's Internal DB URL doesn't require SSL.
  // If you ever use an external Postgres, uncomment the next line:
  // ssl: { rejectUnauthorized: false }
});

// --- tiny id helper
function rid() {
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- create tables + seed one bar
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bars (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      bar_code TEXT NOT NULL REFERENCES bars(code),
      status TEXT NOT NULL CHECK (status IN ('issued','redeemed','void')) DEFAULT 'issued',
      nonce TEXT UNIQUE NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM bars;`);
  if (rows[0].c === 0) {
    await pool.query(
      `INSERT INTO bars (id, code, name) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO NOTHING;`,
      [rid(), 'nav001', 'Bar Navigli']
    );
    console.log('Seeded bar nav001');
  }
}

// --- middleware & static files
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // serves public/index.html, staff.html, admin.html

// --- Pretty customer link: /b/:code -> /?bar=code
app.get('/b/:code', async (req, res) => {
  const { code } = req.params;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bars WHERE code=$1 AND active=TRUE LIMIT 1;`,
    [code]
  );
  if (!rowCount) return res.status(404).send('Invalid bar code');
  res.redirect('/?bar=' + encodeURIComponent(code));
});

// --- Create a claim (guest taps "Get Free Drink")
app.post('/api/claim', async (req, res) => {
  try {
    const { bar, source } = req.body;     // bar = 'nav001'
    if (!bar) return res.status(400).json({ error: 'missing_bar' });

    const ok = await pool.query(
      `SELECT 1 FROM bars WHERE code=$1 AND active=TRUE LIMIT 1;`,
      [bar]
    );
    if (!ok.rowCount) return res.status(400).json({ error: 'unknown_bar' });

    const nonce = rid();
    await pool.query(
      `INSERT INTO claims (id, bar_code, status, nonce, source)
       VALUES ($1,$2,'issued',$3,$4);`,
      [rid(), bar, nonce, source || null]
    );

    res.json({ ok: true, nonce });
  } catch (e) {
    console.error('claim_failed', e);
    res.status(500).json({ error: 'claim_failed' });
  }
});

// --- Redeem a claim (staff-only, bar-locked)
app.post('/api/redeem', async (req, res) => {
  try {
    const { nonce, staffBar } = req.body;
    if (!nonce || !staffBar) return res.status(400).json({ error: 'missing_params' });

    const { rows } = await pool.query(
      `SELECT bar_code, status, created_at FROM claims WHERE nonce=$1 LIMIT 1;`,
      [nonce]
    );
    const claim = rows[0];
    if (!claim) return res.status(404).json({ error: 'not_found' });
    if (claim.status === 'redeemed') return res.status(409).json({ error: 'already_redeemed' });
    if (claim.bar_code !== staffBar) return res.status(403).json({ error: 'wrong_bar' });

    // Optional expiry (24h):
    // if (Date.now() - new Date(claim.created_at).getTime() > 24*60*60*1000)
    //   return res.status(410).json({ error: 'expired' });

    await pool.query(`UPDATE claims SET status='redeemed' WHERE nonce=$1;`, [nonce]);
    res.json({ ok: true });
  } catch (e) {
    console.error('redeem_failed', e);
    res.status(500).json({ error: 'redeem_failed' });
  }
});

// --- Stats (overall or per bar via ?bar=code)
app.get('/api/stats', async (req, res) => {
  const { bar } = req.query;
  const q = bar
    ? `SELECT COUNT(*)::int AS claims,
              SUM(CASE WHEN status='redeemed' THEN 1 ELSE 0 END)::int AS redemptions
       FROM claims WHERE bar_code=$1;`
    : `SELECT COUNT(*)::int AS claims,
              SUM(CASE WHEN status='redeemed' THEN 1 ELSE 0 END)::int AS redemptions
       FROM claims;`;
  const params = bar ? [bar] : [];
  const { rows } = await pool.query(q, params);
  res.json(rows[0] || { claims: 0, redemptions: 0 });
});

// --- List bars
app.get('/api/bars', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT code, name, active, created_at
     FROM bars ORDER BY created_at DESC;`
  );
  res.json(rows);
});

// --- Create bar (used by admin.html form)
app.post('/api/bars', async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'missing_fields' });
    await pool.query(
      `INSERT INTO bars (id, code, name, active) VALUES ($1,$2,$3,TRUE);`,
      [rid(), code, name]
    );
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes('duplicate key')) {
      return res.status(409).json({ error: 'code_taken' });
    }
    console.error('create_bar_failed', e);
    res.status(500).json({ error: 'create_bar_failed' });
  }
});

// --- start
init()
  .then(() => app.listen(PORT, () => console.log(`Server on :${PORT}`)))
  .catch(err => {
    console.error('Init failed', err);
    process.exit(1);
  });
