// server.js — Postgres + QR + Admin view with customer details
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect where HTML lives
const ROOT = path.join(__dirname, "index.html");
const PUB = path.join(__dirname, "public", "index.html");
const hasRootIndex = fs.existsSync(ROOT);
const hasPublicIndex = fs.existsSync(PUB);
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Helper
const rid = () => "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

// Initialize database
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
      customer_name TEXT,
      customer_phone TEXT,
      customer_email TEXT,
      customer_dob DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM bars;`);
  if (rows[0].c === 0) {
    await pool.query(
      `INSERT INTO bars (id, code, name) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO NOTHING;`,
      [rid(), "nav001", "Bar Navigli"]
    );
    console.log("Seeded bar nav001");
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve HTML files
const sendMaybe = (file, res, notFoundMsg) => {
  const rootPath = path.join(__dirname, file);
  const publicPath = path.join(__dirname, "public", file);
  if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
  if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
  return res.status(404).send(notFoundMsg);
};

app.get("/", (_req, res) =>
  hasRootIndex ? res.sendFile(ROOT)
    : hasPublicIndex ? res.sendFile(PUB)
    : res.status(404).send("index.html not found (root or /public)")
);
app.get("/staff.html", (_req, res) => sendMaybe("staff.html", res, "staff.html not found"));
app.get("/admin.html", (_req, res) => sendMaybe("admin.html", res, "admin.html not found"));

// Pretty bar link → /?bar=CODE
app.get("/b/:code", async (req, res) => {
  const { code } = req.params;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bars WHERE code=$1 AND active=TRUE LIMIT 1;`, [code]
  );
  if (!rowCount) return res.status(404).send("Invalid bar code");
  res.redirect("/?bar=" + encodeURIComponent(code));
});

// Create a claim (customer fills form)
app.post("/api/claim", async (req, res) => {
  try {
    const { bar, source, name, phone, email, dob } = req.body;
    if (!bar || !name || !phone || !email || !dob)
      return res.status(400).json({ error: "missing_fields" });

    const ok = await pool.query(
      `SELECT 1 FROM bars WHERE code=$1 AND active=TRUE LIMIT 1;`, [bar]
    );
    if (!ok.rowCount) return res.status(400).json({ error: "unknown_bar" });

    const nonce = rid();
    await pool.query(
      `INSERT INTO claims (id, bar_code, status, nonce, source, customer_name, customer_phone, customer_email, customer_dob)
       VALUES ($1,$2,'issued',$3,$4,$5,$6,$7,$8);`,
      [rid(), bar, nonce, source || null, name, phone, email, dob]
    );
    res.json({ ok: true, nonce });
  } catch (e) {
    console.error("claim_failed", e);
    res.status(500).json({ error: "claim_failed" });
  }
});

// Redeem (staff)
app.post("/api/redeem", async (req, res) => {
  try {
    const { nonce, staffBar } = req.body;
    if (!nonce || !staffBar)
      return res.status(400).json({ error: "missing_params" });

    const { rows } = await pool.query(
      `SELECT bar_code, status FROM claims WHERE nonce=$1 LIMIT 1;`, [nonce]
    );
    const claim = rows[0];
    if (!claim) return res.status(404).json({ error: "not_found" });
    if (claim.status === "redeemed") return res.status(409).json({ error: "already_redeemed" });
    if (claim.bar_code !== staffBar) return res.status(403).json({ error: "wrong_bar" });

    await pool.query(`UPDATE claims SET status='redeemed' WHERE nonce=$1;`, [nonce]);
    res.json({ ok: true });
  } catch (e) {
    console.error("redeem_failed", e);
    res.status(500).json({ error: "redeem_failed" });
  }
});

// Stats (simple totals)
app.get("/api/stats", async (req, res) => {
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

// List bars
app.get("/api/bars", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT code, name, active, created_at FROM bars ORDER BY created_at DESC;`
  );
  res.json(rows);
});

// Create bar
app.post("/api/bars", async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name)
      return res.status(400).json({ error: "missing_fields" });
    await pool.query(
      `INSERT INTO bars (id, code, name, active) VALUES ($1,$2,$3,TRUE);`,
      [rid(), code, name]
    );
    res.json({ ok: true });
  } catch (e) {
    if (String(e).includes("duplicate key"))
      return res.status(409).json({ error: "code_taken" });
    console.error("create_bar_failed", e);
    res.status(500).json({ error: "create_bar_failed" });
  }
});

// NEW: Return all customer claims (for admin view)
app.get("/api/claims", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        id,
        bar_code AS bar,
        customer_name AS name,
        customer_phone AS phone,
        customer_email AS email,
        customer_dob AS dob,
        status,
        created_at
      FROM claims
      ORDER BY created_at DESC;
    `);
    res.json(rows);
  } catch (e) {
    console.error("get_claims_failed", e);
    res.status(500).json({ error: "get_claims_failed" });
  }
});

init()
  .then(() => app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`)))
  .catch(err => {
    console.error("Init failed", err);
    process.exit(1);
  });
