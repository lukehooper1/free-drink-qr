// server.js — Postgres + Express + static HTML anywhere
// Make sure your package.json has "express" and "pg" dependencies only.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const app = express();
const PORT = process.env.PORT || 3000;

// --- file paths setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- connect to Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Internal Render Postgres doesn’t need SSL; external ones do.
  // ssl: { rejectUnauthorized: false }
});

// --- helper for random IDs
function rid() {
  return "id_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// --- create tables and one starter bar
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
      [rid(), "nav001", "Bar Navigli"]
    );
    console.log("Seeded bar nav001");
  }
}

// --- middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Serve your HTML files (even if they’re in repo root)
app.get("/", (_req, res) => {
  // send index.html from the same folder as server.js
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/staff.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "staff.html"));
});

app.get("/admin.html", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// --- Pretty customer link: /b/:code → /?bar=code
app.get("/b/:code", async (req, res) => {
  const { code } = req.params;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM bars WHERE code=$1 AND active=TRUE LIMIT 1;`,
    [code]
  );
  if (!rowCount) return res.status(404).send("Invalid bar code");
  res.redirect("/?bar=" + encodeURIComponent(code));
});

// --- Create a claim
app.post("/api/claim", async (req, res) => {
  try {
    const { bar, source } = req.body;
    if (!bar) return res.status(400).json({ error: "mi
