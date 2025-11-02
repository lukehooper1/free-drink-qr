// public/script-staff-umd.js
// Uses global ZXing from the UMD build. No ES modules.

(function () {
  const video = document.getElementById("preview");
  const staffIdInput = document.getElementById("staffId");
  const setStaffBtn = document.getElementById("setStaff");
  const who = document.getElementById("who");
  const manual = document.getElementById("manual");
  const previewBtn = document.getElementById("previewBtn");
  const redeemBtn = document.getElementById("redeemBtn");
  const result = document.getElementById("result");
  const statusEl = document.getElementById("status");
  const startBtn = document.getElementById("startScanner");

  function getStaff(){ return localStorage.getItem("staff_id") || ""; }
  function setStaff(id){ localStorage.setItem("staff_id", id); who.textContent = id ? `Logged in as ${id}` : ""; }
  setStaff(getStaff());
  setStaffBtn.addEventListener("click", () => setStaff(staffIdInput.value.trim()));

  let reader = null;
  let currentToken = null;
  let started = false;

  function extractCodeOrToken(text) {
    try {
      const u = new URL(text);
      const pTok = u.searchParams.get("token");
      if (pTok) return pTok;
      const m = u.pathname.match(/\/t\/([^/?#]+)/i);
      if (m) return decodeURIComponent(m[1]);
    } catch {}
    if (/^FD-[A-Z0-9]{7}$/i.test(text.trim())) return text.trim().toUpperCase();
    return text.trim();
  }

  async function startScanner() {
    if (started) return; started = true;
    statusEl.textContent = "Requesting camera…";
    video.setAttribute("playsinline", "true");
    video.muted = true;

    try {
      const devices = await ZXing.BrowserMultiFormatReader.listVideoInputDevices();
      if (!devices || devices.length === 0) { statusEl.textContent = "No camera devices found."; return; }

      const rear =
        devices.find(d => /back|rear|environment/i.test(d.label || "")) ||
        devices[devices.length - 1];

      reader = new ZXing.BrowserMultiFormatReader();
      await reader.decodeFromVideoDevice(rear.deviceId, video, (res) => {
        if (res) handleScanned(res.getText());
      });

      statusEl.textContent = "Scanner ready. Point at a QR.";
    } catch (e) {
      // Fallback: default device
      try {
        reader = new ZXing.BrowserMultiFormatReader();
        await reader.decodeFromVideoDevice(null, video, (res) => {
          if (res) handleScanned(res.getText());
        });
        statusEl.textContent = "Scanner ready (fallback).";
      } catch (e2) {
        statusEl.textContent = "Camera error: " + (e.message || e2.message || String(e2));
      }
    }
  }

  async function handleScanned(text) {
    statusEl.textContent = "QR detected";
    const tokenOrCode = extractCodeOrToken(text);
    await fetchPreview(tokenOrCode);
  }

  previewBtn.addEventListener("click", () => {
    const tokenOrCode = extractCodeOrToken(manual.value.trim());
    fetchPreview(tokenOrCode);
  });

  async function fetchPreview(tokenOrCode) {
    if (!tokenOrCode) return;
    result.innerHTML = "Looking up token…";
    try {
      const res = await fetch(`/api/admin/preview?token=${encodeURIComponent(tokenOrCode)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid token");
      currentToken = tokenOrCode;
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

  redeemBtn.addEventListener("click", async () => {
    const t = currentToken || extractCodeOrToken(manual.value.trim());
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
  });

  startBtn.addEventListener("click", startScanner);

  // signal boot success
  window.__STAFF_BOOT_OK__ = true;
})();
