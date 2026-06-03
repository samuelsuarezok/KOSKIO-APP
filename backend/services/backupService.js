// services/backupService.js — Respaldo automático de la base de datos

const fs   = require("fs");
const path = require("path");

const DB_PATH      = path.join(__dirname, "..", "pos_data.db");
const BACKUP_DIR   = path.join(__dirname, "..", "backups");
const MAX_BACKUPS  = 30;   // días de historial a conservar
const INTERVALO_MS = 24 * 60 * 60 * 1000; // 24 horas

let _timer = null;

// ─── Crear carpeta de backups si no existe ────────────────────────────────────
function asegurarDirectorio() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("📁 Carpeta de backups creada:", BACKUP_DIR);
  }
}

// ─── Generar nombre de archivo con fecha y hora ───────────────────────────────
function generarNombreBackup() {
  const ahora   = new Date();
  const yyyy    = ahora.getFullYear();
  const mm      = String(ahora.getMonth() + 1).padStart(2, "0");
  const dd      = String(ahora.getDate()).padStart(2, "0");
  const hh      = String(ahora.getHours()).padStart(2, "0");
  const min     = String(ahora.getMinutes()).padStart(2, "0");
  return `backup_${yyyy}-${mm}-${dd}_${hh}-${min}.db`;
}

// ─── Hacer un backup ahora mismo ─────────────────────────────────────────────
function hacerBackup(motivo = "programado") {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.warn("⚠ Backup omitido: no existe la base de datos todavía.");
      return null;
    }

    asegurarDirectorio();

    const nombreArchivo = generarNombreBackup();
    const destino       = path.join(BACKUP_DIR, nombreArchivo);

    // Copiar el archivo de BD
    fs.copyFileSync(DB_PATH, destino);

    const tamano = (fs.statSync(destino).size / 1024).toFixed(1);
    console.log(`✅ Backup ${motivo}: ${nombreArchivo} (${tamano} KB)`);

    // Limpiar backups viejos
    limpiarBackupsViejos();

    return {
      archivo:   nombreArchivo,
      ruta:      destino,
      tamano_kb: parseFloat(tamano),
      fecha:     new Date().toLocaleString("es-AR"),
    };
  } catch (err) {
    console.error("❌ Error al hacer backup:", err.message);
    return null;
  }
}

// ─── Eliminar backups que superen MAX_BACKUPS ─────────────────────────────────
function limpiarBackupsViejos() {
  try {
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("backup_") && f.endsWith(".db"))
      .map(f => ({
        nombre: f,
        mtime:  fs.statSync(path.join(BACKUP_DIR, f)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime); // más recientes primero

    // Eliminar los que exceden el límite
    const aEliminar = archivos.slice(MAX_BACKUPS);
    aEliminar.forEach(({ nombre }) => {
      fs.unlinkSync(path.join(BACKUP_DIR, nombre));
      console.log(`🗑 Backup viejo eliminado: ${nombre}`);
    });
  } catch (err) {
    console.error("⚠ Error al limpiar backups viejos:", err.message);
  }
}

// ─── Listar todos los backups disponibles ────────────────────────────────────
function listarBackups() {
  try {
    asegurarDirectorio();
    const archivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith("backup_") && f.endsWith(".db"))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          nombre:    f,
          tamano_kb: parseFloat((stat.size / 1024).toFixed(1)),
          fecha:     stat.mtime.toLocaleString("es-AR"),
          timestamp: stat.mtime.getTime(),
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // más recientes primero
    return archivos;
  } catch (err) {
    console.error("⚠ Error al listar backups:", err.message);
    return [];
  }
}

// ─── Iniciar el backup automático diario ─────────────────────────────────────
function iniciarBackupAutomatico() {
  // Backup inmediato al iniciar el servidor
  console.log("\n💾 Backup inicial al arrancar el servidor...");
  hacerBackup("inicio del servidor");

  // Calcular cuánto tiempo falta para medianoche
  const ahora        = new Date();
  const medianoche   = new Date(ahora);
  medianoche.setHours(24, 0, 0, 0); // próxima medianoche
  const msHastaMedia = medianoche.getTime() - ahora.getTime();

  console.log(`⏰ Próximo backup automático: medianoche (en ${Math.round(msHastaMedia / 60000)} minutos)`);

  // Primer disparo a medianoche, luego cada 24 horas
  setTimeout(() => {
    hacerBackup("diario automático");
    _timer = setInterval(() => hacerBackup("diario automático"), INTERVALO_MS);
  }, msHastaMedia);
}

// ─── Detener el timer (para tests o apagado limpio) ──────────────────────────
function detenerBackupAutomatico() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
  hacerBackup,
  listarBackups,
  iniciarBackupAutomatico,
  detenerBackupAutomatico,
};
