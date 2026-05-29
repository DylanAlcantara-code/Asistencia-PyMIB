# ⚙️ PyMIB Attendance System

> Sistema de asistencia industrial offline-first para **Proyecto y Mantenimiento Industrial Bahena (PyMIB)**

---

## 📁 Estructura del Proyecto

```
pymib-attendance/
├── index.html          ← App principal (UI + routing)
├── styles.css          ← Tema industrial oscuro
├── app.js              ← Controlador principal, GPS, confirmaciones
├── qr.js               ← Generación de QR dinámico con expiración
├── scanner.js          ← Escáner QR (html5-qrcode)
├── db.js               ← IndexedDB (almacenamiento offline)
├── sync.js             ← Sincronización con Google Sheets
├── manifest.json       ← Configuración PWA
├── service-worker.js   ← Caché offline completo
├── apps-script.gs      ← Backend Google Apps Script
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 🚀 Despliegue en GitHub Pages

### Paso 1: Preparar repositorio

```bash
git init pymib-attendance
cd pymib-attendance
# Copia todos los archivos aquí
git add .
git commit -m "Initial: PyMIB Attendance PWA"
```

### Paso 2: Crear repo en GitHub

1. Ve a github.com → **New repository**
2. Nombre: `pymib-attendance`
3. Visibility: Public (necesario para GitHub Pages gratis)
4. NO inicialices con README

```bash
git remote add origin https://github.com/TU_USUARIO/pymib-attendance.git
git branch -M main
git push -u origin main
```

### Paso 3: Activar GitHub Pages

1. Ve a tu repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Clic **Save**
5. En ~2 minutos tu app estará en:
   `https://TU_USUARIO.github.io/pymib-attendance/`

### ⚠️ IMPORTANTE para GitHub Pages

El Service Worker y la PWA funcionan **SOLO con HTTPS**.
GitHub Pages sirve HTTPS automáticamente ✓

---

## 📊 Conectar Google Sheets

### Paso 1: Crear la hoja de cálculo

1. Ve a [sheets.google.com](https://sheets.google.com)
2. Crea una nueva hoja llamada **"PyMIB Attendance"**
3. Copia el **ID** de la URL:
   ```
   https://docs.google.com/spreadsheets/d/AQUÍ_ESTÁ_EL_ID/edit
   ```

### Paso 2: Crear el Apps Script

1. Ve a [script.google.com](https://script.google.com)
2. **Nuevo proyecto** → ponle nombre: `PyMIB Attendance API`
3. Borra el código por defecto
4. Pega el contenido de `apps-script.gs`
5. Reemplaza `YOUR_GOOGLE_SHEET_ID_HERE` con el ID de tu hoja

### Paso 3: Desplegar como Web App

1. Clic en **Implementar** → **Nueva implementación**
2. Tipo: **Aplicación web**
3. Descripción: `v1`
4. Ejecutar como: **Yo (tu email)**
5. Acceso: **Cualquier persona** ← IMPORTANTE
6. Clic **Implementar**
7. Autoriza los permisos (acepta todas las solicitudes)
8. **Copia la URL** que termina en `/exec`

### Paso 4: Configurar la URL en sync.js

Abre `sync.js` y reemplaza:
```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_SCRIPT_ID_HERE/exec';
```
Con tu URL real:
```javascript
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby.../exec';
```

### Paso 5: Subir cambios

```bash
git add sync.js
git commit -m "Add Apps Script URL"
git push
```

---

## 📱 Instalar como PWA en Android

### Método automático (Chrome)

1. Abre Chrome en Android
2. Ve a `https://TU_USUARIO.github.io/pymib-attendance/`
3. Chrome mostrará un banner: **"Agregar a pantalla de inicio"**
4. Toca **Instalar**

### Método manual

1. Chrome → menú ⋮ → **"Agregar a pantalla de inicio"**
2. O Chrome → menú ⋮ → **"Instalar app"**

### ✅ Verificar instalación correcta

- La app debe abrirse sin barra de navegador
- Debe funcionar desde la pantalla de inicio
- Debe funcionar **sin internet** después del primer uso

---

## 📡 Cómo funciona la sincronización offline

### Flujo completo

```
┌─────────────────────────────────────────────┐
│             REGISTRO DE ASISTENCIA           │
│                                              │
│  1. Trabajador escanea QR                   │
│  2. Ingresa nombre                           │
│  3. GPS obtenido                             │
│  4. Registro guardado en IndexedDB           │
│     (sincronizado: false)                    │
│                                              │
│  5. Cada 30 segundos:                        │
│     ┌─ ¿Hay internet? ─┐                    │
│     │  NO → esperar    │                    │
│     │  SÍ → continuar  │                    │
│     └──────────────────┘                    │
│                                              │
│  6. Busca registros con sincronizado=false   │
│  7. POST a Google Apps Script                │
│  8. Si respuesta OK → sincronizado=true      │
└─────────────────────────────────────────────┘
```

### Tecnologías usadas

| Componente | Tecnología | Para qué |
|------------|------------|----------|
| Almacenamiento local | IndexedDB | Guardar registros sin internet |
| Caché de archivos | Service Worker | App funcione offline |
| Detección de red | navigator.onLine + fetch probe | Saber si hay internet |
| Sincronización | fetch() POST | Enviar a Google Sheets |
| Background sync | Service Worker sync event | Retry automático |

---

## 🔧 Configuración del QR

El QR contiene un JSON serializado:

```json
{
  "supervisor": "Juan Bahena",
  "proyecto": "Planta PEMEX - Refinería",
  "token": "a3f9c1d2e8b7...",
  "timestamp": 1703123456789,
  "expires": 1703123756789
}
```

- **Token**: aleatorio de 24 caracteres hex (generado con `crypto.getRandomValues`)
- **Expira**: 5 minutos después de generado
- **Regeneración automática**: al expirar se genera uno nuevo
- **Sin internet**: el QR se genera 100% localmente, no necesita red

---

## 📋 Columnas en Google Sheets

| Columna | Descripción |
|---------|-------------|
| Nombre | Trabajador |
| Proyecto | Nombre de la obra |
| Supervisor | Quien generó el QR |
| Tipo | Entrada / Salida |
| Fecha | dd/mm/yyyy |
| Hora | hh:mm:ss |
| Latitud | GPS decimal |
| Longitud | GPS decimal |
| Registrado | Timestamp del servidor |

---

## 🔒 Seguridad y privacidad

- No hay login ni contraseñas para trabajadores
- Los QR expiran en 5 minutos (no reutilizables)
- Cada QR tiene un token aleatorio único
- Los datos GPS solo se usan para registro de ubicación
- No se envían datos a terceros (solo Google Sheets propio)

---

## ❓ Solución de problemas

**La cámara no funciona**
→ Verifica que el sitio tenga HTTPS
→ Acepta permisos de cámara cuando se soliciten
→ En Chrome: Configuración → Privacidad → Permisos de sitio → Cámara

**No se sincroniza**
→ Verifica la URL del Apps Script en `sync.js`
→ Asegúrate de haber desplegado el Script con acceso "Cualquier persona"
→ Revisa la consola del navegador para ver errores

**El GPS no funciona**
→ El GPS requiere HTTPS
→ Acepta permisos de ubicación
→ En interiores el GPS puede tardar más — el registro se hace de todas formas

**La PWA no aparece para instalar**
→ Solo funciona con HTTPS
→ Necesitas Chrome en Android
→ Visita la app al menos una vez con internet para cachear archivos
