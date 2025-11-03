// server.js — universal static server (root or /public)
// Use this to get a clean, green deploy. We'll add DB after.

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Figure out where your HTML lives:
const ROOT_INDEX = path.join(__dirname, "index.html");
const PUBLIC_INDEX = path.join(__dirname, "public", "index.html");
const hasRootIndex = fs.existsSync(ROOT_INDEX);
const hasPublicIndex = fs.existsSync(PUBLIC_INDEX);

// Serve static assets if /public exists
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// Health check
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Home page
app.get("/", (_req, res) => {
  if (hasRootIndex) return res.sendFile(ROOT_INDEX);
  if (hasPublicIndex) return res.sendFile(PUBLIC_INDEX);
  res.status(404).send("index.html not found (root or /public)");
});

// Direct routes for these pages (works in root or /public)
function sendMaybe(file) {
  const rootPath = path.join(__dirname, file);
  const publicPath = path.join(__dirname, "public", file);
  if (fs.existsSync(rootPath)) return rootPath;
  if (fs.existsSync(publicPath)) return publicPath;
  return null;
}

app.get("/staff.html", (_req, res) => {
  const p = sendMaybe("staff.html");
  if (p) return res.sendFile(p);
  res.status(404).send("staff.html not found");
});

app.get("/admin.html", (_req, res) => {
  const p = sendMaybe("admin.html");
  if (p) return res.sendFile(p);
  res.status(404).send("admin.html not found");
});

app.listen(PORT, () => {
  console.log(`✅ Static server running on :${PORT}`);
  console.log(`Looking for HTML in:`, hasRootIndex ? "repo root" : hasPublicIndex ? "/public" : "nowhere (missing)");
});
