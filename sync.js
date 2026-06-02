// sync.js - Google Sheets synchronization
// PyMIB Attendance System

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwcl4d91PItkGyScTALgvZcxLsJBNNA_vi7-exJJuDXekaClokJWnf5-iHlQZtwuY1O/exec';
const SYNC_INTERVAL_MS = 30_000;

let syncIntervalId = null;
let isSyncing = false;

async function checkOnline() {
  return navigator.onLine !== false;
}

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

function buildAppsScriptGetUrl(payload) {
  const params = new URLSearchParams();
  params.set('action', 'append');
  Object.entries(payload).forEach(([key, value]) => {
    params.set(key, value == null ? '' : String(value));
  });
  params.set('_ts', Date.now().toString());
  return `${APPS_SCRIPT_URL}?${params.toString()}`;
}

function sendJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `pymibSync_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const separator = url.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    let finished = false;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    const finish = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (result && result.ok) {
        resolve(result);
      } else {
        reject(new Error((result && result.error) || 'Apps Script no confirmo el guardado'));
      }
    };

    window[callbackName] = finish;
    script.onerror = () => finish({ ok: false, error: 'No se pudo conectar con Apps Script' });
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}`;
    document.body.appendChild(script);
    setTimeout(() => finish({ ok: false, error: 'Tiempo agotado al enviar al Sheet' }), 10000);
  });
}

function sendRecordToSheet(payload) {
  return sendJsonp(buildAppsScriptGetUrl(payload));
}

function buildSheetPayload(record) {
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

async function syncPendingRecords() {
  if (isSyncing) return;

  const online = await checkOnline();
  updateSyncUI(online ? 'online' : 'offline');

  if (!online) return;
  if (APPS_SCRIPT_URL.includes('YOUR_SCRIPT_ID')) return;

  const pending = await getPendingRecords();
  if (pending.length === 0) return;

  isSyncing = true;
  updateSyncUI('syncing');
  console.log(`[PyMIB Sync] Sincronizando ${pending.length} registro(s)...`);

  let synced = 0;
  for (const record of pending) {
    try {
      await sendRecordToSheet(buildSheetPayload(record));

      await markAsSynced(record.id);
      synced++;
    } catch (err) {
      console.warn(`[PyMIB Sync] Error al sincronizar id=${record.id}:`, err);
    }
  }

  isSyncing = false;
  updateSyncUI('online');

  if (synced > 0) {
    showToast(`${synced} registro(s) enviados a Google Sheet`, 'success');
    console.log(`[PyMIB Sync] ${synced} registros enviados`);
  }
}

async function resendAllRecordsToSheet() {
  if (isSyncing) return;

  const online = await checkOnline();
  updateSyncUI(online ? 'online' : 'offline');

  if (!online) {
    showToast('Sin internet para reenviar registros', 'warning', 5000);
    return;
  }

  const allRecords = await getAllRecords();
  if (allRecords.length === 0) {
    showToast('No hay registros locales para reenviar', 'warning', 5000);
    return;
  }

  isSyncing = true;
  updateSyncUI('syncing');

  let sent = 0;
  for (const record of allRecords.slice().reverse()) {
    try {
      await sendRecordToSheet(buildSheetPayload(record));
      await markAsSynced(record.id);
      sent++;
    } catch (err) {
      console.warn(`[PyMIB Sync] Error al reenviar id=${record.id}:`, err);
    }
  }

  isSyncing = false;
  updateSyncUI('online');
  showToast(`${sent} registro(s) reenviados al Sheet`, sent > 0 ? 'success' : 'error', 6000);
}

async function syncNow() {
  await syncPendingRecords();
  const recordsView = document.getElementById('records-view');
  if (recordsView && !recordsView.classList.contains('hidden')) {
    await renderRecords();
  }
}

async function resendAllNow() {
  await resendAllRecordsToSheet();
  const recordsView = document.getElementById('records-view');
  if (recordsView && !recordsView.classList.contains('hidden')) {
    await renderRecords();
  }
}

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
