<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Staff Scanner</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-900">
  <div class="max-w-3xl mx-auto p-4 md:p-8">
    <div class="bg-white shadow rounded-2xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-semibold">Staff Scanner</h2>
        <a href="/admin.html" class="text-sm underline">Admin</a>
      </div>

      <div class="flex items-center gap-2 mb-3">
        <input id="staffId" class="border rounded px-3 py-2" placeholder="Staff ID"/>
        <button id="setStaff" class="bg-slate-800 text-white px-3 py-2 rounded">Set ID</button>
        <span id="who" class="text-sm text-slate-600"></span>
      </div>

      <!-- Start button is crucial for iOS permission -->
      <button id="startScanner" class="bg-slate-800 text-white px-3 py-2 rounded mb-3">Start scanner</button>

      <div class="aspect-video bg-black rounded overflow-hidden mb-3">
        <video id="preview" class="w-full h-full object-cover" playsinline muted></video>
      </div>

      <div class="flex items-center gap-2 mb-3">
        <input id="manual" class="flex-1 border rounded px-3 py-2" placeholder="Manual token or short code (FD-XXXXXXX)"/>
        <button id="previewBtn" class="bg-slate-200 px-3 py-2 rounded">Preview</button>
        <button id="redeemBtn" class="bg-green-600 text-white px-3 py-2 rounded">Redeem</button>
      </div>

      <div id="status" class="text-sm text-slate-600 mb-2"></div>
      <div id="result" class="text-sm"></div>
    </div>
  </div>

  <!-- IMPORTANT: type=module and cache-buster ?v=short4 -->
  <script type="module" src="script-staff.js?v=short4"></script>
</body>
</html>
