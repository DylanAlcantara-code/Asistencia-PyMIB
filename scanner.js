// QR scanner controller

let html5QrScanner = null;
let nativeStream = null;
let nativeScanTimer = null;
let scannedQRData = null;
let scannerRunning = false;

function setCameraButtonVisible(visible) {
  const btn = document.getElementById('btn-start-camera');
  if (btn) btn.classList.toggle('hidden', !visible);
}

function prepareScannerPrompt() {
  if (scannedQRData || scannerRunning) return;

  const statusEl = document.getElementById('scan-status');
  if (statusEl) {
    statusEl.textContent = 'Toca ACTIVAR CAMARA o usa TOMAR FOTO DEL QR';
    statusEl.className = 'scan-status';
  }

  const reader = document.getElementById('qr-reader');
  if (reader && !reader.dataset.ready) reader.innerHTML = '';

  setCameraButtonVisible(true);
}

function userStartScanner() {
  startScanner();
}

function openQRPhotoPicker() {
  const input = document.getElementById('qr-photo-input');
  if (input) input.click();
}

function handleDecodedText(decodedText) {
  const data = validateQRPayload(decodedText);
  if (!data) {
    const statusEl = document.getElementById('scan-status');
    statusEl.textContent = 'QR invalido o expirado. Pide uno nuevo al supervisor.';
    statusEl.className = 'scan-status error';
    showToast('QR expirado o invalido', 'error', 5000);
    return false;
  }

  stopScanner();
  showScannedQRData(data);
  return true;
}

async function scanQRPhoto(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;

  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = 'Leyendo imagen del QR...';
  statusEl.className = 'scan-status';

  try {
    await stopScanner();

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      if (codes && codes.length && handleDecodedText(codes[0].rawValue)) return;
    }

    if (typeof Html5Qrcode !== 'undefined') {
      const reader = document.getElementById('qr-reader');
      reader.innerHTML = '';
      const fileScanner = new Html5Qrcode('qr-reader');
      try {
        const decodedText = await fileScanner.scanFile(file, true);
        if (handleDecodedText(decodedText)) return;
      } finally {
        try { await fileScanner.clear(); } catch {}
      }
    }

    statusEl.textContent = 'No pude leer el QR en la foto. Acercate mas, enfoca bien e intenta de nuevo.';
    statusEl.className = 'scan-status error';
    showToast('No pude leer el QR en la foto', 'error', 5000);
  } catch (err) {
    console.error('[PyMIB Scanner] No se pudo leer la foto:', err);
    statusEl.textContent = 'No pude leer la foto del QR. Intenta con mas luz y el QR completo.';
    statusEl.className = 'scan-status error';
    showToast('No pude leer la foto del QR', 'error', 5000);
  } finally {
    input.value = '';
  }
}

async function startScanner() {
  if (scannerRunning) return;

  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = 'Iniciando camara...';
  statusEl.className = 'scan-status';
  setCameraButtonVisible(false);

  if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    statusEl.textContent = 'La camara requiere HTTPS. Abre la app desde GitHub Pages con https://';
    statusEl.className = 'scan-status error';
    setCameraButtonVisible(true);
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = 'Este navegador no permite acceso a camara. Usa TOMAR FOTO DEL QR.';
    statusEl.className = 'scan-status error';
    setCameraButtonVisible(true);
    return;
  }

  if ('BarcodeDetector' in window) {
    try {
      await startNativeBarcodeScanner();
      return;
    } catch (err) {
      console.warn('[PyMIB Scanner] BarcodeDetector fallo, usando fallback:', err);
      await stopNativeScanner();
    }
  }

  await startHtml5Scanner();
}

async function startNativeBarcodeScanner() {
  const statusEl = document.getElementById('scan-status');
  const reader = document.getElementById('qr-reader');
  reader.innerHTML = '';
  reader.dataset.ready = '1';

  const video = document.createElement('video');
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  video.autoplay = true;
  video.className = 'qr-native-video';
  reader.appendChild(video);

  nativeStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  video.srcObject = nativeStream;
  await video.play();

  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  scannerRunning = true;
  statusEl.textContent = 'Apunta la camara al codigo QR del supervisor';
  statusEl.className = 'scan-status';

  let busy = false;
  nativeScanTimer = setInterval(async () => {
    if (busy || !scannerRunning) return;
    busy = true;
    try {
      const codes = await detector.detect(video);
      if (codes && codes.length) handleDecodedText(codes[0].rawValue);
    } catch (err) {
      console.warn('[PyMIB Scanner] Lectura nativa fallo:', err);
    } finally {
      busy = false;
    }
  }, 350);
}

async function startHtml5Scanner() {
  const statusEl = document.getElementById('scan-status');

  if (typeof Html5Qrcode === 'undefined') {
    statusEl.textContent = 'No se cargo el lector QR. Usa TOMAR FOTO DEL QR o abre con internet una vez.';
    statusEl.className = 'scan-status error';
    setCameraButtonVisible(true);
    return;
  }

  try {
    const reader = document.getElementById('qr-reader');
    reader.innerHTML = '';
    reader.dataset.ready = '1';

    html5QrScanner = new Html5Qrcode('qr-reader');
    const config = { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1.0, disableFlip: false };

    await html5QrScanner.start({ facingMode: 'environment' }, config, onScanSuccess, onScanFailure);
    scannerRunning = true;
    statusEl.textContent = 'Apunta la camara al codigo QR del supervisor';
    statusEl.className = 'scan-status';
  } catch (err) {
    console.error('[PyMIB Scanner] No se pudo iniciar la camara:', err);
    statusEl.textContent = 'No se pudo acceder a la camara. Revisa permisos o usa TOMAR FOTO DEL QR.';
    statusEl.className = 'scan-status error';
    showToast('Error al acceder a la camara', 'error', 6000);
    setCameraButtonVisible(true);
  }
}

async function stopNativeScanner() {
  if (nativeScanTimer) clearInterval(nativeScanTimer);
  nativeScanTimer = null;

  if (nativeStream) {
    nativeStream.getTracks().forEach(track => track.stop());
  }
  nativeStream = null;
}

async function stopScanner() {
  await stopNativeScanner();

  if (html5QrScanner && scannerRunning) {
    try {
      await html5QrScanner.stop();
      html5QrScanner.clear();
    } catch {
      // Ignore scanner cleanup errors.
    }
  }

  scannerRunning = false;
  html5QrScanner = null;

  const reader = document.getElementById('qr-reader');
  if (reader) delete reader.dataset.ready;
}

function onScanSuccess(decodedText) {
  handleDecodedText(decodedText);
}

function showScannedQRData(data) {
  scannedQRData = data;
  setCameraButtonVisible(false);

  const statusEl = document.getElementById('scan-status');
  statusEl.textContent = 'QR escaneado correctamente';
  statusEl.className = 'scan-status success';

  const infoEl = document.getElementById('scanned-info');
  infoEl.classList.remove('hidden');
  infoEl.innerHTML =
    `SUPERVISOR: ${escHtml(data.supervisor)}<br>` +
    `PROYECTO: ${escHtml(data.proyecto)}`;

  setTimeout(() => {
    document.getElementById('qr-info-display').innerHTML =
      `<span class="label">SUPERVISOR</span><br>` +
      `<span class="value">${escHtml(data.supervisor)}</span><br>` +
      `<span class="label">PROYECTO</span><br>` +
      `<span class="value">${escHtml(data.proyecto)}</span>`;

    document.getElementById('step-scan').classList.add('hidden');
    document.getElementById('step-name').classList.remove('hidden');
    document.getElementById('worker-name').focus();
  }, 350);
}

function decodeQRQueryPayload(payload) {
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
    const raw = decodeURIComponent(escape(atob(padded)));
    return validateQRPayload(raw);
  } catch {
    return null;
  }
}

function onScanFailure(error) {
  // Normal while the camera is looking for a QR.
}

function resetScan() {
  scannedQRData = null;
  document.getElementById('step-name').classList.add('hidden');
  document.getElementById('step-scan').classList.remove('hidden');
  document.getElementById('step-confirm').classList.add('hidden');
  document.getElementById('scanned-info').classList.add('hidden');
  document.getElementById('scanned-info').innerHTML = '';
  document.getElementById('worker-name').value = '';
  prepareScannerPrompt();
}

function resetWorker() {
  scannedQRData = null;
  document.getElementById('step-confirm').classList.add('hidden');
  document.getElementById('step-name').classList.add('hidden');
  document.getElementById('step-scan').classList.remove('hidden');
  document.getElementById('scanned-info').classList.add('hidden');
  document.getElementById('worker-name').value = '';
  prepareScannerPrompt();
}
