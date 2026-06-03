// ═══════════════════════════════════════
//  app.js — Main application controller
//  PyMIB Attendance System
// ═══════════════════════════════════════

let currentView = 'home';
let currentRecordsSource = 'local';
let lastSheetRecords = [];
const SUPERVISOR_ACCESS_KEY = 'pymib-supervisor';
const DEFAULT_SUPERVISOR_NAME = 'Gustavo Chavez';

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
    renderSupervisorAuthState();
    setTimeout(() => showInstallBanner(), 800);
  } else if (role === 'worker') {
    document.getElementById('worker-view').classList.remove('hidden');
    currentView = 'worker';
    setTimeout(() => showInstallBanner(), 800);
    setTimeout(() => prepareScannerPrompt(), 150);
  }

  document.getElementById('role-selector').classList.add('hidden');
}

function ensureSupervisorAuthCards() {
  const view = document.getElementById('supervisor-view');
  const header = view.querySelector('.view-header');

  if (!document.getElementById('supervisor-login-card')) {
    const login = document.createElement('div');
    login.id = 'supervisor-login-card';
    login.className = 'card supervisor-auth-card';
    login.innerHTML = `
      <div class="card-label">INICIAR SESION SUPERVISOR</div>
      <div class="form-group">
        <label class="field-label">PASSWORD</label>
        <input type="password" id="supervisor-password" class="field-input" autocomplete="current-password" />
      </div>
      <button class="btn-primary" onclick="handleSupervisorLogin()">ENTRAR</button>
    `;
    header.insertAdjacentElement('afterend', login);
  }

  if (!document.getElementById('supervisor-session-card')) {
    const session = document.createElement('div');
    session.id = 'supervisor-session-card';
    session.className = 'card supervisor-session-card hidden';
    session.innerHTML = `
      <div class="card-label">SESION SUPERVISOR ACTIVA</div>
      <div class="report-actions">
        <button class="btn-secondary" onclick="showSheetRecords()">VER REGISTROS SHEET</button>
        <button class="btn-secondary" onclick="handleSupervisorLogout()">CERRAR SESION</button>
      </div>
    `;
    header.insertAdjacentElement('afterend', session);
  }
}

function renderSupervisorAuthState() {
  ensureSupervisorAuthCards();
  const loggedIn = isSupervisorLoggedIn();
  document.getElementById('supervisor-view').classList.toggle('supervisor-locked', !loggedIn);
  document.getElementById('supervisor-login-card').classList.toggle('hidden', loggedIn);
  document.getElementById('supervisor-session-card').classList.toggle('hidden', !loggedIn);
  applySupervisorDefaults();
}

function applySupervisorDefaults() {
  const supervisorInput = document.getElementById('sup-name');
  if (!supervisorInput) return;
  supervisorInput.value = DEFAULT_SUPERVISOR_NAME;
  supervisorInput.readOnly = true;
}

async function handleSupervisorLogin() {
  const input = document.getElementById('supervisor-password');
  const password = input.value.trim();

  if (!password) {
    showToast('Ingresa el password de supervisor', 'warning', 4000);
    input.focus();
    return;
  }

  try {
    await supervisorLogin(password, true);
    input.value = '';
    renderSupervisorAuthState();
    showToast('Sesion de supervisor iniciada', 'success', 5000);
  } catch (err) {
    console.warn('[PyMIB Supervisor] Login fallido:', err);
    showToast('Password de supervisor incorrecto', 'error', 5000);
  }
}

function handleSupervisorLogout() {
  supervisorLogout();
  renderSupervisorAuthState();
  showToast('Sesion cerrada', 'info', 4000);
}

function getRouteRole() {
  const params = new URLSearchParams(window.location.search);
  const requestedSupervisor = params.get('supervisor') || params.get('admin');
  const role = params.get('role');
  const pageName = (window.location.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();

  if (requestedSupervisor === SUPERVISOR_ACCESS_KEY || role === 'supervisor' || pageName === 'supervisor.html') {
    return 'supervisor';
  }

  return 'worker';
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
  selectRole(getRouteRole());
}

function hideAllViews() {
  ['supervisor-view', 'worker-view', 'records-view'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
}

// ── SHOW RECORDS ──────────────────────
function setRecordsMode(mode) {
  currentRecordsSource = mode;
  const isSheet = mode === 'sheet';
  ['btn-local-sync', 'btn-local-resend'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', isSheet);
  });
  ['btn-sheet-refresh', 'btn-sheet-export'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !isSheet);
  });
}

async function showRecords() {
  hideInstallBanner();
  setRecordsMode('local');
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
async function showSheetRecords() {
  hideInstallBanner();
  setRecordsMode('sheet');

  if (!isSupervisorLoggedIn()) {
    selectRole('supervisor');
    showToast('Inicia sesion de supervisor para ver el Sheet', 'warning', 5000);
    return;
  }

  hideAllViews();
  document.getElementById('role-selector').classList.add('hidden');
  document.getElementById('records-view').classList.remove('hidden');
  currentView = 'records';

  const list = document.getElementById('records-list');
  const countEl = document.getElementById('records-count');
  countEl.textContent = 'Cargando Google Sheet...';
  list.innerHTML = '<div class="empty-state">Cargando registros del Sheet</div>';

  try {
    const records = await fetchSheetRecords(300);
    lastSheetRecords = records;
    renderSheetRecords(records);
  } catch (err) {
    console.warn('[PyMIB Sheet] No se pudieron cargar registros:', err);
    countEl.textContent = 'Error al cargar Sheet';
    list.innerHTML = '<div class="empty-state">No se pudo cargar Google Sheet</div>';
    showToast('No se pudieron cargar registros del Sheet', 'error', 6000);
  }
}

function renderSheetRecords(records) {
  const list = document.getElementById('records-list');
  const countEl = document.getElementById('records-count');
  countEl.textContent = `${records.length} registro${records.length !== 1 ? 's' : ''} en Sheet`;

  if (records.length === 0) {
    list.innerHTML = '<div class="empty-state">Sin registros en Google Sheet</div>';
    return;
  }

  const grouped = groupSheetRecordsByDay(records);
  list.innerHTML = Object.entries(grouped).map(([day, dayRecords]) => `
    <div class="sheet-day-group">
      <div class="sheet-day-header">
        <span>${escHtml(day)}</span>
        <span>${dayRecords.length} registro${dayRecords.length !== 1 ? 's' : ''}</span>
      </div>
      ${dayRecords.map(renderSheetRecordItem).join('')}
    </div>
  `).join('');
}

function normalizeSheetDay(record) {
  const raw = String(record.fecha || record.registrado || '').trim();
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return 'Sin fecha';
  return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[3]}`;
}

function groupSheetRecordsByDay(records) {
  return records.reduce((groups, record) => {
    const day = normalizeSheetDay(record);
    if (!groups[day]) groups[day] = [];
    groups[day].push(record);
    return groups;
  }, {});
}

function renderSheetRecordItem(r) {
  const typeClass = r.tipo === 'Salida' ? 'exit' : 'entry';
  const coords = (r.latitud && r.longitud) ? `${r.latitud}, ${r.longitud}` : 'No disponible';

  return `
    <div class="record-item ${typeClass}">
      <div class="record-header">
        <span class="record-name">${escHtml(r.nombre)}</span>
        <span class="record-badge ${typeClass}">${escHtml(String(r.tipo || '').toUpperCase())}</span>
      </div>
      <div class="record-meta">
        ${escHtml(r.proyecto)} · ${escHtml(r.supervisor)}<br>
        ${escHtml(r.fecha)} · ${escHtml(r.hora)}<br>
        GPS ${escHtml(coords)}<br>
        Registrado: ${escHtml(r.registrado)}
      </div>
      <div class="record-sync synced">GOOGLE SHEET</div>
    </div>`;
}

function parseRecordDate(fecha) {
  if (!fecha) return null;
  const parts = String(fecha).split('/');
  if (parts.length !== 3) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const year = Number(parts[2]);
  const date = new Date(year, month, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateForFile(date) {
  return date.toISOString().slice(0, 10);
}

function excelCell(value) {
  const text = value == null ? '' : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excelSheetName(name) {
  return String(name || 'Registros')
    .replace(/[\\/?*[\]:]/g, '-')
    .slice(0, 31);
}

function buildExcelWorksheet(name, rows) {
  const tableRows = rows.map(row =>
    `<Row>${row.map(value => `<Cell><Data ss:Type="String">${excelCell(value)}</Data></Cell>`).join('')}</Row>`
  ).join('');

  return `
  <Worksheet ss:Name="${excelCell(excelSheetName(name))}">
    <Table>${tableRows}</Table>
  </Worksheet>`;
}

function downloadExcelXml(filename, worksheets) {
  const excelXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheets.join('')}
</Workbook>`;

  const blob = new Blob([excelXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportSheetReport() {
  if (!isSupervisorLoggedIn()) {
    showToast('Inicia sesion de supervisor para descargar el Sheet', 'warning', 5000);
    return;
  }

  if (lastSheetRecords.length === 0) {
    showToast('Cargando registros del Sheet...', 'info', 3000);
    lastSheetRecords = await fetchSheetRecords(300);
  }

  if (lastSheetRecords.length === 0) {
    showToast('No hay registros en el Sheet para descargar', 'warning', 5000);
    return;
  }

  const headers = ['Nombre', 'Proyecto', 'Supervisor', 'Tipo', 'Fecha', 'Hora', 'Latitud', 'Longitud', 'Registrado'];
  const grouped = groupSheetRecordsByDay(lastSheetRecords);
  const worksheets = Object.entries(grouped).map(([day, records]) => {
    const rows = [
      headers,
      ...records.map(record => [
        record.nombre,
        record.proyecto,
        record.supervisor,
        record.tipo,
        record.fecha,
        record.hora,
        record.latitud,
        record.longitud,
        record.registrado
      ])
    ];
    return buildExcelWorksheet(day, rows);
  });

  downloadExcelXml(`PyMIB-Sheet-${formatDateForFile(new Date())}.xls`, worksheets);
  showToast(`Reporte del Sheet descargado (${lastSheetRecords.length} registros)`, 'success', 5000);
}

async function exportAttendanceReport(period = 'daily') {
  const records = await getAllRecords();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start = new Date(today);
  let end = new Date(today);
  let label = 'diario';

  if (period === 'weekly') {
    const day = today.getDay() || 7;
    start.setDate(today.getDate() - day + 1);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
    label = 'semanal';
  }

  const filtered = records.filter(record => {
    const recordDate = parseRecordDate(record.fecha);
    return recordDate && recordDate >= start && recordDate <= end;
  });

  if (filtered.length === 0) {
    showToast(`No hay registros para el reporte ${label}`, 'warning', 5000);
    return;
  }

  const headers = [
    'Nombre',
    'Proyecto',
    'Supervisor',
    'Tipo',
    'Fecha',
    'Hora',
    'Latitud',
    'Longitud',
    'Sincronizado',
    'Registrado local'
  ];

  const rows = filtered.map(record => [
    record.nombre,
    record.proyecto,
    record.supervisor,
    record.tipo,
    record.fecha,
    record.hora,
    record.latitud,
    record.longitud,
    record.sincronizado ? 'Si' : 'No',
    record.timestamp_local || ''
  ]);

  const tableRows = [headers, ...rows].map(row =>
    `<Row>${row.map(value => `<Cell><Data ss:Type="String">${excelCell(value)}</Data></Cell>`).join('')}</Row>`
  ).join('');

  const excelXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Asistencias">
    <Table>${tableRows}</Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([excelXml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PyMIB-reporte-${label}-${formatDateForFile(start)}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast(`Reporte ${label} descargado (${filtered.length} registros)`, 'success', 5000);
}

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
    const localId = await saveRecord(record);
    record.id = localId;
    console.log('[PyMIB] Registro guardado:', record);

    try {
      btn.textContent = 'ENVIANDO AL SHEET...';
      await sendRecordToSheet(buildSheetPayload(record));
      await markAsSynced(localId);
      record.sincronizado = true;
      showToast('Registro enviado a Google Sheet', 'success', 5000);
    } catch (syncErr) {
      console.warn('[PyMIB Sync] No se pudo enviar de inmediato:', syncErr);
      showToast('Guardado en el telefono. Se enviara al Sheet cuando haya conexion.', 'warning', 6000);
      setTimeout(() => syncPendingRecords(), 1000);
    }

    showConfirmation(record);

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
    <div class="row">
      <span class="key">SHEET</span>
      <span class="val ${record.sincronizado ? 'entry' : 'exit'}">${record.sincronizado ? 'ENVIADO' : 'PENDIENTE'}</span>
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

function hideInstallBanner() {
  const banner = document.getElementById('pwa-banner');
  if (banner) banner.remove();
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
