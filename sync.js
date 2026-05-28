// ═══════════════════════════════════════
//  sync.js — Google Sheets synchronization
//  PyMIB Attendance System
// ═══════════════════════════════════════

/**
 * ⚙️  REPLACE THIS URL with your deployed Google Apps Script Web App URL
 *    After deploying apps-script.gs, paste the URL here:
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx4SJ-b_hGhTLwjUnwubSnleFcRAr4Rmnyj5osqe1R2SaOxuSdxlgWvj9nXIaLbhlPy/exec';

const SYNC_INTERVAL_MS = 30_000; // 30 seconds

let syncIntervalId = null;
let isSyncing      = false;

/**
 * Check if we have internet connectivity
 */
async function checkOnline() {
  if (!navigator.onLine) return false;
  try {
    // Light probe — use a tiny public resource
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 4000);
    await fetch('https://www.gstatic.com/generate_204', {
      method: 'HEAD',
      signal: ctrl.signal,
      mode: 'no-cors'
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Update the UI sync indicator
 */
function updateSyncUI(state) {
  const dot   = document.getElementById('sync-indicator');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;

  dot.className   = `sync-dot ${state}`;
  label.textContent = {
    online:  'EN LÍNEA',
    offline: 'OFFLINE',
    syncing: 'SYNC...'
  }[state] || 'OFFLINE';
}

/**
 * Sync all pending records to Google Sheets
 */
async function syncPendingRecords() {
  if (isSyncing) return;

  const online = await checkOnline();
  updateSyncUI(online ? 'online' : 'offline');

  if (!online) return;
  if (APPS_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) {
    // Script not configured yet — skip silently
    return;
  }

  const pending = await getPendingRecords();
  if (pending.length === 0) return;

  isSyncing = true;
  updateSyncUI('syncing');
  console.log(`[PyMIB Sync] Sincronizando ${pending.length} registro(s)...`);

  let synced = 0;
  for (const record of pending) {
    try {
      await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          id_local:   record.id,
          nombre:     record.nombre,
          supervisor: record.supervisor,
          proyecto:   record.proyecto,
          tipo:       record.tipo,
          fecha:      record.fecha,
          hora:       record.hora,
          latitud:    record.latitud,
          longitud:   record.longitud
        })
      });

      await markAsSynced(record.id);
      synced++;
    } catch (err) {
      console.warn(`[PyMIB Sync] Error al sincronizar id=${record.id}:`, err);
    }
  }

  isSyncing = false;
  updateSyncUI('online');

  if (synced > 0) {
    showToast(`✓ ${synced} registro(s) sincronizado(s)`, 'success');
    console.log(`[PyMIB Sync] ${synced} registros sincronizados ✓`);
  }
}

/**
 * Manual sync trigger (called by button)
 */
async function syncNow() {
  await syncPendingRecords();
  // Refresh records view if open
  if (!document.getElementById('records-view').classList.contains('hidden')) {
    await renderRecords();
  }
}

/**
 * Start the background sync loop
 */
function startSyncLoop() {
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(syncPendingRecords, SYNC_INTERVAL_MS);

  // Run once immediately
  syncPendingRecords();

  // Also react to browser online/offline events
  window.addEventListener('online',  () => {
    updateSyncUI('online');
    syncPendingRecords();
  });
  window.addEventListener('offline', () => updateSyncUI('offline'));
}
