// ═══════════════════════════════════════
//  app.js — Main application controller
//  PyMIB Attendance System
// ═══════════════════════════════════════

let currentView = 'home';
const SUPERVISOR_ACCESS_KEY = 'pymib-supervisor';

// ── INIT ──────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
      console.log('[PyMIB SW] Service Worker registrado ✓');
    } catch (e) {
      console.warn('[PyMIB SW] Error al registrar SW:', e);
    }
  }

  // Initialize DB
  await initDB();

  // Start sync loop
  startSyncLoop();

  // Splash animation
  setTimeout(() => {
    const splash = document.getElementById('splash');
    const app    = document.getElementById('app');
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      app.classList.remove('hidden');
      openInitialRoute();
    }, 600);
  }, 2000);
});

function openInitialRoute() {
  const params = new URLSearchParams(window.location.search);
  const requestedSupervisor = params.get('supervisor') || params.get('admin');
  const role = params.get('role');
  const pageName = window.location.pathname.split('/').pop().toLowerCase();
  const workerMode = params.has('worker') || params.has('trabajador') || role === 'worker';
  const qrPayload = params.get('qr');

  if (requestedSupervisor === SUPERVISOR_ACCESS_KEY || pageName === 'supervisor.html') {
    selectRole('supervisor');
    return;
  }

  if (qrPayload) {
    const data = decodeQRQueryPayload(qrPayload);
    if (data) {
      selectRole('worker', { startCamera: false });
      showScannedQRData(data);
      return;
    }
    showToast('QR expirado o invalido. Escanea uno nuevo.', 'error', 5000);
  }

  if (workerMode || pageName === 'worker.html' || !requestedSupervisor) {
    selectRole('worker');
    return;
  }

  selectRole('worker');
  showToast('Acceso de supervisor no autorizado.', 'error', 5000);
}

// ── ROLE SELECTION ────────────────────
function selectRole(role, options = {}) {
  hideAllViews();

  if (role === 'supervisor') {
    document.getElementById('supervisor-view').classList.remove('hidden');
    currentView = 'supervisor';
    setTimeout(() => showInstallBanner(), 800);
  } else if (role === 'worker') {
    document.getElementById('worker-view').classList.remove('hidden');
    currentView = 'worker';
    setTimeout(() => showInstallBanner(), 800);
    setTimeout(() => prepareScannerPrompt(), 150);
  }

  document.getElementById('role-selector').classList.add('hidden');
}

function goBack() {
  // Stop scanner if active
  stopScanner();

  // Stop QR timer if active
  if (typeof qrTimerInterval !== 'undefined' && qrTimerInterval) {
    clearInterval(qrTimerInterval);
  }

  hideAllViews();
  document.getElementById('role-selector').classList.add('hidden');
  const pageName = window.location.pathname.split('/').pop().toLowerCase();
  selectRole(pageName === 'supervisor.html' ? 'supervisor' : 'worker');
}

function hideAllViews() {
  ['supervisor-view', 'worker-view', 'records-view'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

// ── SHOW RECORDS ──────────────────────
async function showRecords() {
  hideAllViews();
  document.getElementById('role-selector').classList.add('hidden');
  document.getElementById('records-view').classList.remove('hidden');
  currentView = 'records';
  await renderRecords();
}

async function renderRecords() {
  const list = document.getElementById('records-list');
  const countEl = document.getElementById('records-count');

  const records = await getAllRecords();
  countEl.textContent = `${records.length} registro${records.length !== 1 ? 's' : ''}`;

  if (records.length === 0) {
    list.innerHTML = '<div class="empty-state">⚙ Sin registros aún</div>';
    return;
  }

  list.innerHTML = records.map(r => {
    const typeClass = r.tipo === 'Entrada' ? 'entry' : 'exit';
    const syncClass = r.sincronizado ? 'synced' : 'pending';
    const syncText  = r.sincronizado ? '✓ SINCRONIZADO' : '⟳ PENDIENTE';
    const coords    = (r.latitud && r.longitud)
      ? `${parseFloat(r.latitud).toFixed(5)}, ${parseFloat(r.longitud).toFixed(5)}`
      : 'No disponible';

    return `
      <div class="record-item ${typeClass}">
        <div class="record-header">
          <span class="record-name">${escHtml(r.nombre)}</span>
          <span class="record-badge ${typeClass}">${r.tipo.toUpperCase()}</span>
        </div>
        <div class="record-meta">
          ${escHtml(r.proyecto)} · ${escHtml(r.supervisor)}<br>
          ${r.fecha} · ${r.hora}<br>
          📍 ${coords}
        </div>
        <div class="record-sync ${syncClass}">${syncText}</div>
      </div>`;
  }).join('');
}

// ── ATTENDANCE REGISTRATION ───────────
async function registerAttendance() {
  const nombreEl = document.getElementById('worker-name');
  const nombre   = nombreEl.value.trim();

  if (!scannedQRData) {
    showToast('⚠ Primero escanea el QR del supervisor', 'warning');
    return;
  }

  if (!nombre) {
    showToast('⚠ Ingresa tu nombre completo', 'warning');
    nombreEl.focus();
    return;
  }

  // Show loading state
  const btn = document.querySelector('#step-name .btn-primary');
  btn.disabled     = true;
  btn.textContent  = '📍 OBTENIENDO GPS...';

  // Get GPS
  let latitud  = null;
  let longitud = null;

  try {
    const pos = await getGPS();
    latitud  = pos.coords.latitude.toFixed(7);
    longitud = pos.coords.longitude.toFixed(7);
  } catch (gpsErr) {
    console.warn('[PyMIB GPS] GPS no disponible:', gpsErr);
    showToast('⚠ GPS no disponible — registrando sin coordenadas', 'warning');
  }

  // Determine Entrada or Salida
  const lastRecord = await getLastRecord(nombre, scannedQRData.proyecto);
  let tipo = 'Entrada';

  if (lastRecord) {
    tipo = lastRecord.tipo === 'Entrada' ? 'Salida' : 'Entrada';
  }

  // Build record
  const now    = new Date();
  const fecha  = now.toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' });
  const hora   = now.toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  const record = {
    nombre,
    supervisor: scannedQRData.supervisor,
    proyecto:   scannedQRData.proyecto,
    tipo,
    fecha,
    hora,
    latitud,
    longitud,
    sincronizado: false
  };

  try {
    await saveRecord(record);
    console.log('[PyMIB] Registro guardado:', record);

    // Show confirmation
    showConfirmation(record);

    // Trigger sync attempt
    setTimeout(() => syncPendingRecords(), 1000);

  } catch (dbErr) {
    console.error('[PyMIB] Error al guardar:', dbErr);
    showToast('Error al guardar el registro', 'error');
  }

  btn.disabled    = false;
  btn.innerHTML   = '<span class="btn-icon">📍</span> REGISTRAR ASISTENCIA';
}

/**
 * Show the confirmation step
 */
function showConfirmation(record) {
  const isEntry = record.tipo === 'Entrada';

  document.getElementById('step-name').classList.add('hidden');

  const confirmStep = document.getElementById('step-confirm');
  confirmStep.classList.remove('hidden');

  document.getElementById('confirm-icon').textContent = isEntry ? '✅' : '👋';
  document.getElementById('confirm-type-label').textContent =
    isEntry ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA';

  const typeClass = isEntry ? 'entry' : 'exit';
  const coords    = (record.latitud && record.longitud)
    ? `${record.latitud}, ${record.longitud}`
    : 'No disponible';

  document.getElementById('confirm-details').innerHTML = `
    <div class="row">
      <span class="key">TRABAJADOR</span>
      <span class="val">${escHtml(record.nombre)}</span>
    </div>
    <div class="row">
      <span class="key">TIPO</span>
      <span class="val ${typeClass}">${record.tipo.toUpperCase()}</span>
    </div>
    <div class="row">
      <span class="key">SUPERVISOR</span>
      <span class="val">${escHtml(record.supervisor)}</span>
    </div>
    <div class="row">
      <span class="key">PROYECTO</span>
      <span class="val">${escHtml(record.proyecto)}</span>
    </div>
    <div class="row">
      <span class="key">FECHA</span>
      <span class="val">${record.fecha}</span>
    </div>
    <div class="row">
      <span class="key">HORA</span>
      <span class="val">${record.hora}</span>
    </div>
    <div class="row">
      <span class="key">GPS</span>
      <span class="val">${coords}</span>
    </div>
  `;

  showToast(`✓ ${record.tipo} registrada correctamente`, 'success');
}

// ── GPS ───────────────────────────────
function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation no soportada'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout:            10000,
      maximumAge:         60000
    });
  });
}

// ── TOAST ─────────────────────────────
const toastTimers = [];

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast     = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${escHtml(message)}</span>`;

  container.appendChild(toast);

  const timer = setTimeout(() => {
    toast.style.animation = 'toast-out .3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
  toastTimers.push(timer);
}

// ── UTILS ─────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── PWA INSTALL PROMPT ────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (currentView === 'supervisor' || currentView === 'worker') showInstallBanner();
});

function showInstallBanner() {
  // Don't show if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (document.getElementById('pwa-banner')) return;

  const banner = document.createElement('div');
  banner.id        = 'pwa-banner';
  banner.className = 'pwa-banner';
  const installName = currentView === 'supervisor' ? 'PyMIB Supervisor' : 'PyMIB Trabajador';
  banner.innerHTML = `
    <div class="pwa-banner-icon">📲</div>
    <div class="pwa-banner-text">
      <strong>INSTALAR ${installName}</strong>
      <span>Funciona sin internet · Acceso rápido</span>
    </div>
    <div class="pwa-banner-btns">
      <button class="pwa-install-btn" onclick="installPWA()">INSTALAR</button>
      <button class="pwa-dismiss-btn" onclick="dismissBanner()">✕</button>
    </div>`;
  document.body.appendChild(banner);
}

async function installPWA() {
  if (!deferredInstallPrompt) {
    showToast('En Chrome: menu de tres puntos > Instalar app o Agregar a pantalla de inicio.', 'info', 7000);
    return;
  }
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log('[PyMIB PWA] Install outcome:', outcome);
  deferredInstallPrompt = null;
  dismissBanner();
}

function dismissBanner() {
  const b = document.getElementById('pwa-banner');
  if (b) b.remove();
}

window.addEventListener('appinstalled', () => {
  console.log('[PyMIB PWA] App instalada ✓');
  dismissBanner();
  showToast('✓ PyMIB instalada correctamente', 'success');
});
