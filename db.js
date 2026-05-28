// ═══════════════════════════════════════
//  db.js — IndexedDB offline storage
//  PyMIB Attendance System
// ═══════════════════════════════════════

const DB_NAME    = 'PyMIB_DB';
const DB_VERSION = 1;
const STORE_NAME = 'asistencias';

let db = null;

/**
 * Initialize IndexedDB
 */
function initDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('sincronizado', 'sincronizado', { unique: false });
        store.createIndex('nombre',       'nombre',       { unique: false });
        store.createIndex('fecha',        'fecha',        { unique: false });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      console.log('[PyMIB DB] IndexedDB listo ✓');
      resolve(db);
    };

    req.onerror = (e) => {
      console.error('[PyMIB DB] Error al abrir DB:', e.target.error);
      reject(e.target.error);
    };
  });
}

/**
 * Save an attendance record
 * @param {Object} record
 * @returns {Promise<number>} id of new record
 */
async function saveRecord(record) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add({
      ...record,
      sincronizado: false,
      timestamp_local: new Date().toISOString()
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Get ALL records (most recent first)
 */
async function getAllRecords() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Get records NOT yet synced
 */
async function getPendingRecords() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    const index   = store.index('sincronizado');
    const req     = index.getAll(false);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Mark a record as synced
 * @param {number} id
 */
async function markAsSynced(id) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(id);
    req.onsuccess = () => {
      const record = req.result;
      if (record) {
        record.sincronizado = true;
        record.synced_at    = new Date().toISOString();
        const upd = store.put(record);
        upd.onsuccess = () => resolve(true);
        upd.onerror   = () => reject(upd.error);
      } else {
        resolve(false);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get the last attendance record for a given worker name + project
 * to determine Entrada vs Salida
 * @param {string} nombre
 * @param {string} proyecto
 */
async function getLastRecord(nombre, proyecto) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => {
      const all = req.result;
      // Filter by worker + project, sort descending by id
      const filtered = all
        .filter(r => r.nombre === nombre && r.proyecto === proyecto)
        .sort((a, b) => b.id - a.id);
      resolve(filtered.length > 0 ? filtered[0] : null);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Count pending records
 */
async function countPending() {
  const pending = await getPendingRecords();
  return pending.length;
}
