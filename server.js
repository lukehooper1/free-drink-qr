// Minimal server to verify Render starts + serves your HTML.
// After this goes green, we’ll switch to the Postgres version.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Serve your HTML files even if they’re in the repo root
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/staff.html", (_req, res) => res.sendFile(path.join(__dirname, "staff.html")));
app.get("/admin.html", (_req, res) => res.sendFile(path.join(__dirname, "admin.html")));

// 2) Health check (handy for Render)
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// 3) Start
app.listen(PORT, () => console.log(`✅ Minimal server running on :${PORT}`));
