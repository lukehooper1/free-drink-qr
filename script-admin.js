
const rangeSel = document.getElementById("range");
const btnRefresh = document.getElementById("refresh");
const btnExport = document.getElementById("export");
const tbody = document.getElementById("tbody");

async function load() {
  const range = rangeSel.value;
  const s = await fetch(`/api/admin/stats?campaign_id=1&range=${range}`).then(r=>r.json());
  document.getElementById("k-scans").textContent = s.totals?.scans ?? "—";
  document.getElementById("k-signups").textContent = s.totals?.signups ?? "—";
  document.getElementById("k-reds").textContent = s.totals?.redemptions ?? "—";
  document.getElementById("k-conv").textContent = (s.totals?.conversion ?? 0) + "%";

  const r = await fetch(`/api/admin/recent?campaign_id=1&range=${range}`).then(r=>r.json());
  tbody.innerHTML = "";
  (r.items || []).forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="py-2 pr-2">${row.time}</td><td class="py-2 pr-2">${row.name}</td><td class="py-2 pr-2">${row.phone}</td><td class="py-2">${row.status}</td>`;
    tbody.appendChild(tr);
  });
  if ((r.items || []).length === 0) {
    const tr = document.createElement("tr"); tr.innerHTML = `<td class="py-3 text-center text-slate-500" colspan="4">No data yet</td>`; tbody.appendChild(tr);
  }
}

btnRefresh.onclick = load;
rangeSel.onchange = load;

btnExport.onclick = async () => {
  const range = rangeSel.value;
  const r = await fetch(`/api/admin/recent?campaign_id=1&range=${range}`).then(r=>r.json());
  const header = "time,phone,name,status,campaign\\n";
  const rows = (r.items || []).map(x => [x.time, x.phone, (x.name||'').replace(/,/g,' '), x.status, x.campaign_name].join(","));
  const blob = new Blob([header + rows.join("\\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `redemptions_${range}.csv`; a.click(); URL.revokeObjectURL(url);
};

load();
