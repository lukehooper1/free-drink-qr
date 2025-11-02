// public/script-staff.js
// Tries BarcodeDetector (fast) → falls back to ZXing → allows manual entry.
// Starts camera on a button click (required by iOS). Requests the rear camera.

const video = document.getElementById("preview");
const staffIdInput = document.getElementById("staffId");
const setStaffBtn = document.getElementById("setStaff");
const who = document.getElementById("who");
const manual = document.getElementById("manual");
const previewBtn = document.getElementById("previewBtn");
const redeemBtn = document.getElementById("redeemBtn");
const result = document.getElementById("result");
const statusEl = document.getElementById("status");

// Add Start button if missing
let startBtn = document.getElementById("startScanner");
if (!startBtn) {
  startBtn = document.createElement("button");
  startBtn.id = "startScanner";
  startBtn.className = "bg-slate-800 text-white px-3 py-2 rounded mb-3";
  startBtn.textContent = "Start scanner";
  video.parentElement.parentElement.insertBefore(startBtn, video.parentElement);
}

function getStaff(){ return localStorage.getItem("staff_id") || ""; }
function setStaff(id){ localStorage.setItem("staff_id", id); who.textContent = id ? `Logged in as ${id}` : ""; }
setStaff(getStaff());
setStaffBtn.onclick = () => setStaff(staffIdInput.value.trim());

// Fallback: ZXing (loaded dynamically if needed)
let ZXReader = null;
async function loadZXing(){
  if (ZXReader) return ZXReader;
  const mod = await import("https://unpkg.com/@zxing/browser@0.1.5/esm/index.js");
  ZXReader = new mod.BrowserMultiFormatReader();
  return ZXReader;
}

let stream, rafId, detector, started = false;

async function getRearStream() {
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
  return navigator.mediaDevices.getUserMedia(constraints);
}

async function startScanner() {
  if (started) return;
  started = true;
  statusEl.textContent = "Requesting camera…";
  video.setAttribute("playsinline", "true"); // iOS requirement
  video.muted = true;

  try {
    stream = await getRearStream();
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    statusEl.textContent = "Camera permission denied or not available.";
    return;
  }

  // Try BarcodeDetector first (fast on modern mobiles)
  if ('BarcodeDetector' in window) {
    try {
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      statusEl.textContent = "Scanner ready (BarcodeDetector). Point at a QR.";
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      const tick = async () => {
        if (!video.videoWidth) { rafId = requestAnimationFrame(tick); return; }
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const bitmap = await createImageBitmap(canvas);
        try {
          const codes = await detector.detect(bitmap);
          if (codes && codes.length) {
            handleScanned(codes[0].rawValue);
          }
        } catch {}
        rafId = requestAnimationFrame(tick);
      };
      tick();
      return;
    } catch (e) {
      // fall through to ZXing
    }
  }

  // Fallback: ZXing
  try {
    const Reader = await loadZXing();
    statusEl.textContent = "Scanner ready (ZXing).";
    await ZXReader.decodeFromVideoDevice(null, video, (res) => {
      if (res) handleScanned(res.getText());
    });
  } catch (e) {
    statusEl.textContent = "Scanner error: " + (e.message || String(e));
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
  if (!token) return;
  result.innerHTML = "Looking up token…";
  try {
    const res = await fetch(`/api/admin/preview?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Invalid token");
    window.__currentToken = token;
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
  const t = window.__currentToken || manual.value.trim();
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
