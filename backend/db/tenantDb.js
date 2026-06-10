// db/tenantDb.js — Factory de bases de datos por tenant
// Cada negocio tiene su propio archivo .db en backend/db/tenants/

const initSqlJs = require("sql.js");
const fs        = require("fs");
const path      = require("path");
const bcrypt    = require("bcryptjs");

const TENANTS_DIR = path.join(__dirname, "tenants");
let SQL = null;

// Cache de instancias activas: { tenantId: { db, run, get, all, ... } }
const cache = {};

// Asegurar que existe la carpeta de tenants
function asegurarDir() {
  if (!fs.existsSync(TENANTS_DIR)) fs.mkdirSync(TENANTS_DIR, { recursive: true });
}

// ── Helpers internos para cada instancia ──────────────────────────────────────

function _wrapDb(db, dbPath) {
  const persistir = () => {
    try { fs.writeFileSync(dbPath, Buffer.from(db.export())); }
    catch (e) { console.error(`⚠ Error persistiendo ${path.basename(dbPath)}:`, e.message); }
  };

  let _lastRowId = 0;
  const run = (sql, params = []) => {
    db.run(sql, params);
    _lastRowId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] || 0;
    persistir();
  };

  const get = (sql, params = []) => {
    const stmt = db.prepare(sql); stmt.bind(params);
    if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
    stmt.free(); return null;
  };

  const all = (sql, params = []) => {
    const results = db.exec(sql, params);
    if (!results || !results.length) return [];
    const { columns, values } = results[0];
    return values.map(row => {
      const obj = {}; columns.forEach((c, i) => { obj[c] = row[i]; }); return obj;
    });
  };

  const lastInsertRowid = () => _lastRowId;

  const transaction = (fn) => {
    db.run("BEGIN TRANSACTION");
    try {
      fn({ run: (sql, params = []) => db.run(sql, params), get, all, lastInsertRowid });
      db.run("COMMIT");
      persistir();
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  };

  return { run, get, all, lastInsertRowid, transaction, raw: db, persistir };
}

// ── Crear las tablas dentro de un tenant DB ──────────────────────────────────

function _crearTablas(db) {
  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_barras TEXT    NOT NULL UNIQUE,
    nombre        TEXT    NOT NULL,
    precio        REAL    NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    stock_minimo  INTEGER NOT NULL DEFAULT 5,
    creado_en     TEXT    DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT   DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    total       REAL NOT NULL,
    efectivo    REAL NOT NULL DEFAULT 0,
    vuelto      REAL NOT NULL DEFAULT 0,
    medio_pago  TEXT NOT NULL DEFAULT 'efectivo',
    cae         TEXT,
    cae_vto     TEXT,
    estado      TEXT DEFAULT 'completada',
    facturada   INTEGER NOT NULL DEFAULT 0,
    usuario_id  INTEGER,
    creado_en   TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS venta_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id    INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad    INTEGER NOT NULL,
    precio_unit REAL    NOT NULL,
    subtotal    REAL    NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT    NOT NULL,
    usuario       TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    rol           TEXT    NOT NULL DEFAULT 'cajero' CHECK(rol IN ('admin','cajero')),
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT    DEFAULT (datetime('now','localtime')),
    ultimo_acceso TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cierres_caja (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha           TEXT    NOT NULL,
    cantidad_ventas INTEGER NOT NULL DEFAULT 0,
    monto_total     REAL    NOT NULL DEFAULT 0,
    total_efectivo  REAL    NOT NULL DEFAULT 0,
    total_vuelto    REAL    NOT NULL DEFAULT 0,
    notas           TEXT,
    admin_id        INTEGER,
    creado_en       TEXT    DEFAULT (datetime('now','localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    clave     TEXT PRIMARY KEY,
    valor     TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
}

// ── Seed config por defecto ──────────────────────────────────────────────────

function _seedConfig(wrappedDb, tenantNombre) {
  const defaults = [
    ["negocio_nombre",      tenantNombre],
    ["negocio_direccion",   ""],
    ["negocio_cuit",        ""],
    ["negocio_telefono",    ""],
    ["negocio_email",       ""],
    ["ticket_mensaje",      "¡Gracias por su compra!"],
    ["punto_venta",         "1"],
    ["tipo_comprobante",    "11"],
    ["stock_minimo_alerta", "5"],
  ];
  defaults.forEach(([clave, valor]) => {
    wrappedDb.run("INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)", [clave, valor]);
  });
}

// ═══ API PÚBLICA ═════════════════════════════════════════════════════════════

/**
 * Inicializa sql.js (se llama una vez al arrancar el servidor).
 */
async function initTenantEngine() {
  SQL = await initSqlJs();
  asegurarDir();
  console.log("✅ Motor de tenants inicializado.");
}

/**
 * Crea una nueva BD para un tenant y le configura un admin.
 * @returns {object} wrapped DB
 */
function crearTenantDb(tenantId, tenantNombre, adminNombre, adminUsuario, adminPasswordHash) {
  asegurarDir();
  const dbPath = path.join(TENANTS_DIR, `tenant_${tenantId}.db`);

  if (fs.existsSync(dbPath)) {
    throw new Error(`Ya existe una BD para el tenant ${tenantId}`);
  }

  const db = new SQL.Database();
  _crearTablas(db);

  const wrapped = _wrapDb(db, dbPath);

  // Crear admin del negocio
  wrapped.run(
    "INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)",
    [adminNombre, adminUsuario, adminPasswordHash, "admin"]
  );

  // Config por defecto
  _seedConfig(wrapped, tenantNombre);

  console.log(`🏪 Tenant #${tenantId} creado: ${tenantNombre}`);
  cache[tenantId] = wrapped;
  return wrapped;
}

/**
 * Carga la BD de un tenant (desde disco o cache).
 * @returns {object|null} wrapped DB o null si no existe
 */
function cargarTenantDb(tenantId) {
  // Si ya está en cache, devolver
  if (cache[tenantId]) return cache[tenantId];

  const dbPath = path.join(TENANTS_DIR, `tenant_${tenantId}.db`);
  if (!fs.existsSync(dbPath)) return null;

  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  // Aplicar migraciones por si acaso
  _crearTablas(db);

  const wrapped = _wrapDb(db, dbPath);
  cache[tenantId] = wrapped;
  return wrapped;
}

/**
 * Lista los archivos de BD de tenants existentes.
 */
function listarTenantDbs() {
  asegurarDir();
  return fs.readdirSync(TENANTS_DIR)
    .filter(f => f.startsWith("tenant_") && f.endsWith(".db"))
    .map(f => {
      const stat = fs.statSync(path.join(TENANTS_DIR, f));
      return { archivo: f, tamano_kb: (stat.size / 1024).toFixed(1), fecha: stat.mtime };
    });
}

module.exports = { initTenantEngine, crearTenantDb, cargarTenantDb, listarTenantDbs };
