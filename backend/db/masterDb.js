// db/masterDb.js — Base de datos maestra (tenants, planes, superadmin)
// Esta BD es global, NO pertenece a ningún tenant individual.

const initSqlJs = require("sql.js");
const fs        = require("fs");
const path      = require("path");
const bcrypt    = require("bcryptjs");

const MASTER_DB_PATH = path.join(__dirname, "..", "master.db");
let db = null;

function persistir() {
  try { fs.writeFileSync(MASTER_DB_PATH, Buffer.from(db.export())); }
  catch (e) { console.error("⚠ Error persistiendo master.db:", e.message); }
}

function run(sql, params = []) {
  db.run(sql, params);
  _lastRowId = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0] || 0;
  persistir();
}
let _lastRowId = 0;

function get(sql, params = []) {
  const stmt = db.prepare(sql); stmt.bind(params);
  if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
  stmt.free(); return null;
}

function all(sql, params = []) {
  const results = db.exec(sql, params);
  if (!results || !results.length) return [];
  const { columns, values } = results[0];
  return values.map(row => {
    const obj = {}; columns.forEach((c, i) => { obj[c] = row[i]; }); return obj;
  });
}

function lastId() {
  return _lastRowId;
}

async function initMasterDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(MASTER_DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(MASTER_DB_PATH));
    console.log("✅ Master DB cargada.");
  } else {
    db = new SQL.Database();
    console.log("✅ Master DB creada.");
  }

  // ── Tabla de planes ─────────────────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS planes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre            TEXT NOT NULL UNIQUE,
    max_productos     INTEGER NOT NULL DEFAULT 50,
    max_usuarios      INTEGER NOT NULL DEFAULT 3,
    max_ventas_mes    INTEGER NOT NULL DEFAULT 500,
    precio_mensual    REAL NOT NULL DEFAULT 0,
    activo            INTEGER NOT NULL DEFAULT 1
  )`);

  // ── Tabla de tenants (negocios) ─────────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS tenants (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo            TEXT NOT NULL UNIQUE,
    nombre            TEXT NOT NULL,
    email_contacto    TEXT,
    telefono          TEXT,
    plan_id           INTEGER NOT NULL DEFAULT 1,
    activo            INTEGER NOT NULL DEFAULT 1,
    fecha_vencimiento TEXT,
    creado_en         TEXT DEFAULT (datetime('now','localtime')),
    actualizado_en    TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── Tabla de superadmins (admins de la plataforma, NO de un negocio) ────────
  db.run(`CREATE TABLE IF NOT EXISTS superadmins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    usuario       TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    creado_en     TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ── Tabla de pagos / suscripciones ──────────────────────────────────────────
  db.run(`CREATE TABLE IF NOT EXISTS pagos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id       INTEGER NOT NULL,
    monto           REAL NOT NULL,
    medio           TEXT NOT NULL DEFAULT 'mercadopago',
    referencia_pago TEXT,
    estado          TEXT NOT NULL DEFAULT 'pendiente',
    periodo_desde   TEXT,
    periodo_hasta   TEXT,
    creado_en       TEXT DEFAULT (datetime('now','localtime'))
  )`);

  persistir();

  // Seed planes si están vacíos
  const cp = get("SELECT COUNT(*) as c FROM planes");
  if (!cp || cp.c === 0) {
    db.run("INSERT INTO planes (nombre, max_productos, max_usuarios, max_ventas_mes, precio_mensual) VALUES (?,?,?,?,?)",
      ["Gratuito", 20, 2, 100, 0]);
    db.run("INSERT INTO planes (nombre, max_productos, max_usuarios, max_ventas_mes, precio_mensual) VALUES (?,?,?,?,?)",
      ["Básico", 200, 5, 2000, 4999]);
    db.run("INSERT INTO planes (nombre, max_productos, max_usuarios, max_ventas_mes, precio_mensual) VALUES (?,?,?,?,?)",
      ["Profesional", 999999, 20, 999999, 9999]);
    persistir();
    console.log("📋 Planes creados: Gratuito, Básico, Profesional.");
  }

  // Seed superadmin si no existe
  const cs = get("SELECT COUNT(*) as c FROM superadmins");
  if (!cs || cs.c === 0) {
    const hash = bcrypt.hashSync("super123", 10);
    db.run("INSERT INTO superadmins (nombre, usuario, password_hash) VALUES (?,?,?)",
      ["Super Admin", "superadmin", hash]);
    persistir();
    console.log("👑 Superadmin creado — usuario: superadmin | contraseña: super123");
  }

  console.log("✅ Master DB lista.\n");
}

function getMasterDb() {
  if (!db) throw new Error("Master DB no inicializada.");
  return { run, get, all, lastId };
}

module.exports = { initMasterDb, getMasterDb };
