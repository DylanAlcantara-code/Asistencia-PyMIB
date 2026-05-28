// ═══════════════════════════════════════
//  qr.js — QR code generation
//  PyMIB Attendance System
// ═══════════════════════════════════════

const QR_EXPIRY_SECONDS = 300; // 5 minutos

let qrTimerInterval = null;
let qrExpiresAt     = null;
let qrData          = null;

function generateToken() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

function generateQR() {
  const supervisor = document.getElementById('sup-name').value.trim();
  const proyecto   = document.getElementById('sup-project').value.trim();

  if (!supervisor) {
    showToast('⚠ Ingresa el nombre del supervisor', 'warning');
    document.getElementById('sup-name').focus();
    return;
  }
  if (!proyecto) {
    showToast('⚠ Ingresa el proyecto/obra', 'warning');
    document.getElementById('sup-project').focus();
    return;
  }

  const now   = Date.now();
  qrExpiresAt = now + QR_EXPIRY_SECONDS * 1000;

  qrData = {
    supervisor,
    proyecto,
    token:     generateToken(),
    timestamp: now,
    expires:   qrExpiresAt
  };

  const payload = buildWorkerQRUrl(qrData);

  // Show container
  document.getElementById('qr-container').classList.remove('hidden');

  // Meta info
  document.getElementById('qr-meta').innerHTML =
    `<div>SUPERVISOR: <span>${supervisor}</span></div>
     <div>PROYECTO: <span>${proyecto}</span></div>
     <div>GENERADO: <span>${new Date().toLocaleTimeString('es-MX')}</span></div>`;

  // ── Render QR using QRCode constructor (qrcodejs API) ──
  const wrap = document.getElementById('qr-canvas-wrap');
  wrap.innerHTML = ''; // clear previous

  if (typeof QRCode === 'undefined') {
    wrap.innerHTML = '<div class="qr-error">No se cargo el generador QR. Abre la app con internet una vez para actualizarla.</div>';
    showToast('No se pudo cargar el generador QR', 'error', 6000);
    return;
  }

  try {
    new QRCode(wrap, {
      text:         payload,
      width:        220,
      height:       220,
      colorDark:    '#000000',
      colorLight:   '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (err) {
    console.error('[PyMIB QR] Error al generar QR:', err);
    wrap.innerHTML = '<div class="qr-error">No se pudo generar el QR. Regenera o actualiza la app.</div>';
    showToast('No se pudo generar el QR', 'error', 6000);
    return;
  }

  // Prefer the canvas because some Android/PWA contexts do not show the generated img.
  setTimeout(() => {
    const img = wrap.querySelector('img');
    const cvs = wrap.querySelector('canvas');
    if (cvs) {
      cvs.style.display = 'block';
      cvs.style.borderRadius = '6px';
      cvs.removeAttribute('style');
    }
    if (img) {
      img.style.display = 'none';
    }
  }, 100);

  startQRTimer();
  showToast('✓ QR generado exitosamente', 'success');
}

function startQRTimer() {
  if (qrTimerInterval) clearInterval(qrTimerInterval);

  const timerEl = document.getElementById('qr-timer');
  const barEl   = document.getElementById('timer-bar');

  // Remove CSS transition so bar moves smoothly every second
  barEl.style.transition = 'none';

  function tick() {
    const remaining = Math.max(0, qrExpiresAt - Date.now());
    const secs      = Math.floor(remaining / 1000);
    const mins      = Math.floor(secs / 60);
    const s         = secs % 60;
    const pct       = (remaining / (QR_EXPIRY_SECONDS * 1000)) * 100;

    timerEl.textContent = `${mins}:${String(s).padStart(2, '0')}`;
    barEl.style.width   = pct + '%';

    timerEl.classList.remove('urgent', 'critical');
    barEl.classList.remove('urgent', 'critical');

    if (secs <= 30) {
      timerEl.classList.add('critical');
      barEl.classList.add('critical');
    } else if (secs <= 90) {
      timerEl.classList.add('urgent');
      barEl.classList.add('urgent');
    }

    if (remaining <= 0) {
      clearInterval(qrTimerInterval);
      showToast('⚡ QR expirado — regenerando automáticamente', 'info');
      setTimeout(() => generateQR(), 800);
    }
  }

  tick();
  qrTimerInterval = setInterval(tick, 1000);
}

function validateQRPayload(raw) {
  try {
    let payload = raw;

    try {
      const url = new URL(raw);
      const qrParam = url.searchParams.get('qr');
      if (qrParam) {
        const base64 = qrParam.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
        payload = decodeURIComponent(escape(atob(padded)));
      }
    } catch {
      // Raw JSON QR from older versions is still accepted.
    }

    const data = JSON.parse(payload);
    if (!data.supervisor || !data.proyecto || !data.token || !data.expires) return null;
    if (Date.now() > data.expires) return null;
    return data;
  } catch {
    return null;
  }
}

function buildWorkerQRUrl(data) {
  const url = new URL('worker.html', window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('worker', '1');
  url.searchParams.set('qr', encodeQRQueryPayload(JSON.stringify(data)));
  return url.toString();
}

function encodeQRQueryPayload(payload) {
  const base64 = btoa(unescape(encodeURIComponent(payload)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
