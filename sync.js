// ============================================================================
// sync.js - Google Sheets synchronization
// PyMIB Attendance System
// ============================================================================

/**
 * Replace this URL with your deployed Google Apps Script Web App URL.
 * After deploying apps-script.gs, paste the URL here.
 */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwCs25F2kBxDhwMH7rRTaQolPFqecFP56sK7V3HyX8gZtVScN7vWoowkwyO56cjZxr1/exec';

const SYNC_INTERVAL_MS = 30_000; // 30 seconds
const SYNC_TIMEOUT_MS = 15_000;

let syncIntervalId = null;
let isSyncing = false;

/**
 * Check if we have internet connectivity.
 */
async function checkOnline() {
  return navigator.onLine !== false;
}

/**
 * Update the UI sync indicator.
 */
function updateSyncUI(state) {
  const dot = document.getElementById('sync-indicator');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;

  dot.className = `sync-dot ${state}`;
  label.textContent = {
    online: 'EN LINEA',
    offline: 'OFFLINE',
    syncing: 'SYNC...'
  }[state] || 'OFFLINE';
}

function buildSyncPayload(record) {
  return {
    id_local: record.id,
    nombre: record.nombre,
    supervisor: record.supervisor,
    proyecto: record.proyecto,
    tipo: record.tipo,
    fecha: record.fecha,
    hora: record.hora,
    latitud: record.latitud,
    longitud: record.longitud
  };
}

/**
 * Apps Script Web Apps do not reliably expose CORS headers to GitHub Pages.
 * JSONP lets the page receive the real backend result before marking a record
 * as synced locally.
 */
function postRecordToSheet(payload) {
  return new Promise((resolve, reject) => {
    const callbackName = `__pymibSync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    let timeoutId = null;

    const cleanup = () => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[callbackName] = (response) => {
      cleanup();
      if (!response || response.ok !== true) {
        reject(new Error((response && response.error) || 'Apps Script rechazo el registro'));
        return;
      }
      resolve(response);
    };

    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', 'append');
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('payload', JSON.stringify(payload));

    if (url.toString().length > 7000) {
      cleanup();
      reject(new Error('El registro es demasiado largo para sincronizarse'));
      return;
    }

    script.async = true;
    script.src = url.toString();
    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo contactar Apps Script'));
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Tiempo de espera agotado al sincronizar'));
    }, SYNC_TIMEOUT_MS);

    document.head.appendChild(script);
  });
}

/**
 * Sync all pending records to Google Sheets.
 */
async function syncPendingRecords() {
  if (isSyncing) return;

  const online = await checkOnline();
  updateSyncUI(online ? 'online' : 'offline');

  if (!online) return;
  if (APPS_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) {
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
      const response = await postRecordToSheet(buildSyncPayload(record));
      await markAsSynced(record.id);
      synced++;

      const status = response.duplicate ? 'ya existia' : 'guardado';
      console.log(`[PyMIB Sync] id=${record.id} ${status} en Google Sheets`);
    } catch (err) {
      console.warn(`[PyMIB Sync] Error al sincronizar id=${record.id}:`, err);
    }
  }

  isSyncing = false;
  updateSyncUI('online');

  if (synced > 0) {
    showToast(`OK ${synced} registro(s) sincronizado(s)`, 'success');
    console.log(`[PyMIB Sync] ${synced} registros sincronizados`);
  }
}

/**
 * Manual sync trigger (called by button).
 */
async function syncNow() {
  await syncPendingRecords();
  if (!document.getElementById('records-view').classList.contains('hidden')) {
    await renderRecords();
  }
}

/**
 * Re-send every local record. Useful when older app versions marked records as
 * synced even though the sheet rejected them.
 */
async function resyncAllRecords() {
  const accepted = confirm('Reenviar todos los registros locales a Google Sheets?');
  if (!accepted) return;

  await markAllAsPending();
  showToast('Registros listos para reenviar', 'info');
  await syncNow();
}

/**
 * Start the background sync loop.
 */
function startSyncLoop() {
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(syncPendingRecords, SYNC_INTERVAL_MS);

  syncPendingRecords();

  window.addEventListener('online', () => {
    updateSyncUI('online');
    syncPendingRecords();
  });
  window.addEventListener('offline', () => updateSyncUI('offline'));
}
