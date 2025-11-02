// public/script-staff.js
import { BrowserMultiFormatReader } from "https://unpkg.com/@zxing/browser@0.1.5/esm/index.js";

const video = document.getElementById("preview");
const staffIdInput = document.getElementById("staffId");
const setStaffBtn = document.getElementById("setStaff");
const who = document.getElementById("who");
const manual = document.getElementById("manual");
const previewBtn = document.getElementById("previewBtn");
const redeemBtn = document.getElementById("redeemBtn");
const result = document.getElementById("result");
const statusEl = document.getElementById("status");

// Add a start button if it doesn't exist yet (older HTML didn't have one)
let startBtn = document.getElementById("startScanner");
if (!startBtn) {
  startBtn = document.createElement("button");
  startBtn.id = "startScanner";
  startBtn.className = "bg-slate-800 text-white px-3 py-2 rounded mb-3";
  startBtn.textContent = "Start scanner";
  video.parentElement.parentElement.insertBefore(startBtn, video.parentElement);
}

function getStaff() { return localStorage.getItem("staff_id") || ""; }
function setStaff(id) { localStorage.setItem("staff_id", id); who.textContent = id ? `Logged in as ${id}` : ""; }
setStaff(getStaff());
setStaffBtn.onclick = () => setStaff(staffIdInput.value.trim());

let reader;
let currentToken = null;
let started = false;

async function startScanner() {
  if (started) return;
  started = true;
  statusEl.textContent = "Requesting camera…";
  video.setAttribute("playsinline", "true"); // iOS requirement
  try {
    // Prefer back camera
    const constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    // ZXing on the active <video>
    reader = new BrowserMultiFormatReader();
    await reader.decodeFromVideoDevice(null, video, (res, err) => {
      if (res) {
        const text = res.getText();
        handleScanned(text);
      }
    });
    statusEl.textContent = "Scanner ready. Point at a QR.";
  } catch (e) {
    // Try explicit device selection fallback
    try {
      const devices = await BrowserMultiFormatReader.listVideoInputDevices();
      if (!devices || devices.length === 0) throw new Error("No camera found");
      const back = devices.find(d => /back|rear|environment/i.test(`${d.label}`)) || devices[0];
      reader = new BrowserMultiFormatReader();
      await reader.decodeFromVideoDevice(back.deviceId, video, (res) => {
        if (res) handleScanned(res.getText());
      });
      statusEl.textContent = "Scanner ready (fallback).";
    } catch (e2) {
      statusEl.textContent = "Camera error: " + (e.message || e2.message || String(e2));
    }
  }
}
startBtn.onclick = startScanner;

async function handleScanned(text) {
  statusEl.textContent = "Scanned";
  let token = text;
  try { const u = new URL(text); token = u.searchParams.get("token") || text; } catch {}
  await fetchPreview(token);
}

previewBtn.onclick = () => handleScanned(manual.value.trim());

async function fetchPreview(token) {
  result.innerHTML = "Looking up token…";
  try {
    const res = await fetch(`/api/admin/preview?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Invalid token");
    currentToken = token;
    result.innerHTML = `<div class="border rounded p-3">
      <div><b>Name:</b> ${data.name || "—"}</div>
      <div><b>Phone:</b> ${data.phone || "—"}</div>
      <div><b>Campaign:</b> ${data.campaign_name || "—"}</div>
      <div><b>Status:</b> ${data.redeemed_at ? "Already redeemed" : "Active"}</div>
      <div><b>Expires:</b> ${data.token_expires ? new Date(data.token_expires).toLocaleTimeString() : "—"}</div>
    </div>`;
  } catch (e) {
    result.innerHTML = `<div class="text-red-600">${e.message || String(e)}</div>`;
  }
}

redeemBtn.onclick = async () => {
  const t = currentToken || manual.value.trim();
  if (!t) { alert("No token"); return; }
  const staff = getStaff() || "staff";
  redeemBtn.disabled = true; redeemBtn.textContent = "Redeeming…";
  try {
    let coords = {};
    try {
      const loc = await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:2000}));
      coords = { device_lat: loc.coords.latitude, device_lng: loc.coords.longitude };
    } catch {}
    const res = await fetch("/api/redeem", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ token: t, staff_id: staff, ...coords }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Redeem failed");
    result.innerHTML = `<div class="text-green-700">Redeemed for ${data.name} at ${new Date(data.redeemed_at).toLocaleTimeString()}</div>`;
  } catch (e) {
    result.innerHTML = `<div class="text-red-600">${e.message || String(e)}</div>`;
  } finally {
    redeemBtn.disabled = false; redeemBtn.textContent = "Redeem";
  }
};
