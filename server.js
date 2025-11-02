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
app.use(express.static(__dirname)); // serve all files (html, css, js, etc.) from root

// Path to simple JSON file store
const STORE_PATH = path.join(__dirname, "store.json");

// Helper functions
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
function nowIso() {
  return new Date().toISOString();
}
function genToken() {
  return crypto.randomBytes(24).toString("hex");
}
function isOverAge(dobStr, legal = 18) {
  const dob = new Date(dobStr);
  if (isNaN(dob)) return false;
  const ageMs = Date.now() - dob.getTime();
  const years = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
  return years >= legal;
}

// Initialize store and seed campaign
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

// ===== Routes =====

// Home route (serves index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Track scan (optional analytics)
app.post("/api/track/scan", (req, res) => {
  const { source = "poster", campaign_id = 1 } = req.body || {};
  store.scans.push({ t: nowIso(), source, campaign_id });
  saveStore(store);
  res.json({ ok: true });
});

// Create claim (guest signup)
app.post("/api/claim", (req, res) => {
  const { campaign_id = 1, name, phone, dob, instagram_handle, source = "poster" } = req.body || {};
  if (!name || !phone || !dob) return res.status(400).json({ error: "Missing fields" });
  if (!isOverAge(dob, 18)) return res.status(400).json({ error: "Under legal drinking age" });

  const today = new Date().toDateString();
  const dup = store.claims.find(c => c.phone === phone && new Date(c.created_at).toDateString() === today);
  if (dup) return res.status(400).json({ error: "You already claimed today" });

  const token = genToken();
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
    token_expires,
    created_at: nowIso(),
    redeemed_at: null,
    redeemed_by: null,
    source,
  };
  store.claims.push(claim);
  saveStore(store);

  const redeem_url = `${req.protocol}://${req.get("host")}/staff.html?token=${token}`;
  res.json({ success: true, token, redeem_url });
});

// Preview token (for staff)
app.get("/api/admin/preview", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: "Missing token" });
  const c = store.claims.find(x => x.token === token);
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

// Redeem token
app.post("/api/redeem", (req, res) => {
  const { token, staff_id = "staff", device_lat, device_lng } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing token" });
  const c = store.claims.find(x => x.token === token);
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

// Admin stats
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

// Admin recent
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

// Start server
app.listen(PORT, () => {
  console.log(`Free Drink QR running on port ${PORT}`);
});
