const claimBtn = document.getElementById("claimBtn");
const errEl = document.getElementById("error");
const qrArea = document.getElementById("qr-area");
const formArea = document.getElementById("form-area");
const src = new URLSearchParams(location.search).get("src") || "poster";

async function trackScan(){
  try { await fetch("/api/track/scan", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ source: src, campaign_id: 1 })}); } catch {}
}
trackScan();

claimBtn.onclick = async () => {
  errEl.textContent = "";
  const name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const dob = document.getElementById("dob").value;
  const consent = document.getElementById("consent").checked;
  if (!name || !phone || !dob || !consent) {
    errEl.textContent = "Please fill all fields and tick the consent box.";
    return;
  }
  claimBtn.disabled = true; claimBtn.textContent = "Generating…";
  try {
    const res = await fetch("/api/claim", { method:"POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ campaign_id:1, name, phone, dob, source: src })});
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "Request failed");

    // Show SHORT CODE in the QR for fast scanning
    formArea.classList.add("hidden");
    qrArea.classList.remove("hidden");

    const el = document.getElementById("qrcode");
    el.innerHTML = "";
    new QRCode(el, { text: data.short_code, width: 240, height: 240 });
    const input = document.getElementById("redeemUrl");
    input.value = data.short_code + "  (short code)";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch(e) {
    errEl.textContent = e.message || String(e);
  } finally {
    claimBtn.disabled = false; claimBtn.textContent = "Get my free drink QR";
  }
};
