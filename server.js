import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname)); // serve html/js/css from repo root

// ---------- simple file store ----------
const STORE_PATH = path.join(__dirname, "store.json");
function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return { campaigns: [], claims: [], redemptions: [], scans: [] };
  }
}
function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}
let store = loadStore();
if (store.campaigns.length === 0) {
  store.campaigns.push({
    id: 1,
    name: "Student Night",
    free_item: "Free Shot",
    start_time: new Date(Date.now() - 3600_000).toISOString(),
    end_time: new Date(Date.now() + 6 * 3600_000).toISOString(),
  });
  saveStore(store);
}

// ---------- helpers ----------
const nowIso = () => new Date().toISOString();
const genToken = () => crypto.randomBytes(24).toString("hex");
function genShortCode() {
  // 7-char base36 code like FD-3K9T7Q (prefix optional)
  const n = BigInt("0x" + crypto.randomBytes(5).toString("hex")); // 40 bits
  return "FD-" + n.toString(36).toUpperCase().padStart(7, "0");
}
function isOverAge(dobStr, legal = 18) {
  const dob = new Date(dobStr);
  if (isNaN(dob)) return false;
  const years = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return years >= legal;
}

// ---------- routes ----------
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.post("/api/track/scan", (req, res) => {
  const { source = "poster", campaign_id = 1 } = req.body || {};
  store.scans.push({ t: nowIso(), source, campaign_id });
  saveStore(store);
  res.json({ ok: true });
});

app.post("/api/claim", (req, res) => {
  const { campaign_id = 1, name, phone, dob, instagram_handle, source = "poster" } = req.body || {};
  if (!name || !phone || !dob) return res.status(400).json({ error: "Missing fields" });
  if (!isOverAge(dob, 18)) return res.status(400).json({ error: "Under legal drinking age" });

  // one per phone per day
  const today = new Date().toDateString();
  const dup = store.claims.find(c => c.phone === phone && new Date(c.created_at).toDateString() === today);
  if (dup) return res.status(400).json({ error: "You already claimed today" });

  const token = genToken();
  let short_code = genShortCode();
  while (store.claims.find(c => c.short_code === short_code)) short_code = genShortCode();

  const token_expires = new Date(Date.now() + 6 * 3600_000).toISOString();
  const claim = {
    id: store.claims.length + 1,
    campaign_id,
    name,
    phone,
    dob,
    instagram_handle,
    age_verified: true,
    token,
    short_code,               // <-- NEW
    token_expires,
    created_at: nowIso(),
    redeemed_at: null,
    redeemed_by: null,
    source,
  };
  store.claims.push(claim);
  saveStore(store);

  const short_url = `${req.protocol}://${req.get("host")}/t/${encodeURIComponent(short_code)}`;
  res.json({ success: true, token, short_code, short_url });
});

// Resolve short URL to staff page (handy if someone scans guest QR in staff mode)
app.get("/t/:code", (_req, res) => {
  // just send staff page; the scanner reads the code itself
  res.sendFile(path.join(__dirname, "staff.html"));
});

// Helper to find claim by either token OR short code
function findClaimByAny(input) {
  if (!input) return null;
  const clean = String(input).trim();
  return (
    store.claims.find(c => c.token === clean) ||
    store.claims.find(c => c.short_code === clean) ||
    null
  );
}

// Staff preview (accepts token OR short code in ?token=)
app.get("/api/admin/preview", (req, res) => {
  const input = req.query.token || req.query.code;
  const c = findClaimByAny(input);
  if (!input) return res.status(400).json({ error: "Missing token" });
  if (!c) return res.status(404).json({ error: "Invalid token" });
  const campaign = store.campaigns.find(k => k.id === c.campaign_id);
  res.json({
    name: c.name,
    phone: c.phone,
    campaign_name: campaign?.name || String(c.campaign_id),
    token_expires: c.token_expires,
    redeemed_at: c.redeemed_at,
    created_at: c.created_at,
  });
});

// Redeem (accepts token OR short code)
app.post("/api/redeem", (req, res) => {
  const { token, staff_id = "staff", device_lat, device_lng } = req.body || {};
  const c = findClaimByAny(token);
  if (!token) return res.status(400).json({ error: "Missing token" });
  if (!c) return res.status(404).json({ error: "Invalid token" });
  if (c.redeemed_at) return res.status(400).json({ error: "Already redeemed" });
  if (new Date() > new Date(c.token_expires)) return res.status(400).json({ error: "Token expired" });

  c.redeemed_at = nowIso();
  c.redeemed_by = staff_id;
  store.redemptions.push({
    id: store.redemptions.length + 1,
    claim_id: c.id,
    staff_id,
    redeemed_at: c.redeemed_at,
    device_lat,
    device_lng,
  });
  saveStore(store);
  res.json({ success: true, name: c.name, redeemed_at: c.redeemed_at });
});

app.get("/api/admin/stats", (req, res) => {
  const { campaign_id = 1, range = "today" } = req.query;
  const now = new Date();
  let start = new Date(now);
  if (range === "today") start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "7d") start = new Date(now.getTime() - 7 * 86400000);
  if (range === "30d") start = new Date(now.getTime() - 30 * 86400000);

  const scans = store.scans.filter(s => new Date(s.t) >= start && s.campaign_id == campaign_id);
  const claims = store.claims.filter(c => new Date(c.created_at) >= start && c.campaign_id == campaign_id);
  const reds = store.redemptions.filter(r => new Date(r.redeemed_at) >= start);

  const byHour = {};
  const bucket = d => `${new Date(d).getHours()}:00`;
  scans.forEach(s => { const k = bucket(s.t); byHour[k] = byHour[k] || { t: k, scans: 0, signups: 0, redemptions: 0 }; byHour[k].scans++; });
  claims.forEach(c => { const k = bucket(c.created_at); byHour[k] = byHour[k] || { t: k, scans: 0, signups: 0, redemptions: 0 }; byHour[k].signups++; });
  reds.forEach(r => { const k = bucket(r.redeemed_at); byHour[k] = byHour[k] || { t: k, scans: 0, signups: 0, redemptions: 0 }; byHour[k].redemptions++; });

  const series = Object.values(byHour).sort((a, b) => parseInt(a.t) - parseInt(b.t));
  const totals = {
    scans: scans.length,
    signups: claims.length,
    redemptions: reds.length,
    conversion: claims.length ? Math.round((reds.length / claims.length) * 100) : 0,
  };
  res.json({ totals, series });
});

app.get("/api/admin/recent", (req, res) => {
  const { campaign_id = 1, range = "today" } = req.query;
  const now = new Date();
  let start = new Date(now);
  if (range === "today") start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "7d") start = new Date(now.getTime() - 7 * 86400000);
  if (range === "30d") start = new Date(now.getTime() - 30 * 86400000);

  const rows = store.claims
    .filter(c => new Date(c.created_at) >= start && c.campaign_id == campaign_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50)
    .map(c => ({
      time: new Date(c.created_at).toLocaleString(),
      name: c.name,
      phone: c.phone,
      status: c.redeemed_at ? "Redeemed" : "Unredeemed",
      campaign_name: (store.campaigns.find(k => k.id === c.campaign_id)?.name) || String(c.campaign_id),
    }));

  res.json({ items: rows });
});

app.listen(PORT, () => {
  console.log(`Free Drink QR running on port ${PORT}`);
});
