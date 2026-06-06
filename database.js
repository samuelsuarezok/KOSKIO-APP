// db/database.js — KOSKIO APP v1.2.0

const initSqlJs = require("sql.js");
const fs        = require("fs");
const path      = require("path");
const bcrypt    = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "pos_data.db");
let db = null;

function persistirEnDisco() {
  try {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) {
    console.error("⚠ Error al persistir BD:", err.message);
  }
}

function run(sql, params = []) { db.run(sql, params); persistirEnDisco(); }

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}

function all(sql, params = []) {
  const results = db.exec(sql, params);
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map(row => { const obj = {}; columns.forEach((col, i) => { obj[col] = row[i]; }); return obj; });
}

function lastInsertRowid() { const row = get("SELECT last_insert_rowid() as id"); return row ? row.id : null; }

async function initDatabase() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
    console.log("✅ BD cargada desde:", DB_PATH);
  } else {
    db = new SQL.Database();
    console.log("✅ Nueva BD SQLite creada.");
  }

  db.run("PRAGMA journal_mode = WAL");

  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_barras TEXT    NOT NULL UNIQUE,
    nombre        TEXT    NOT NULL,
    precio        REAL    NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    creado_en     TEXT    DEFAULT (datetime('now', 'localtime')),
    actualizado_en TEXT   DEFAULT (datetime('now', 'localtime'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    total      REAL NOT NULL,
    efectivo   REAL NOT NULL,
    vuelto     REAL NOT NULL,
    cae        TEXT,
    cae_vto    TEXT,
    estado     TEXT DEFAULT 'completada',
    facturada  INTEGER NOT NULL DEFAULT 0,
    usuario_id INTEGER,
    creado_en  TEXT DEFAULT (datetime('now', 'localtime'))
  )`);
  // Migración: agregar columna facturada si no existe (para BDs anteriores)
  try { db.run("ALTER TABLE ventas ADD COLUMN facturada INTEGER NOT NULL DEFAULT 0"); } catch(_) {}

  // Tabla de configuración del negocio
  db.run(`CREATE TABLE IF NOT EXISTS configuracion (
    clave     TEXT PRIMARY KEY,
    valor     TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // Valores por defecto si la tabla está vacía
  const cfgCount = get("SELECT COUNT(*) as c FROM configuracion");
  if (!cfgCount || cfgCount.c === 0) {
    const defaults = [
      ["negocio_nombre",    "KOSKIO APP"],
      ["negocio_direccion", ""],
      ["negocio_cuit",      ""],
      ["negocio_telefono",  ""],
      ["negocio_email",     ""],
      ["ticket_mensaje",    "¡Gracias por su compra!"],
      ["punto_venta",       "1"],
      ["tipo_comprobante",  "11"],
    ];
    defaults.forEach(([clave, valor]) => {
      db.run("INSERT INTO configuracion (clave, valor) VALUES (?, ?)", [clave, valor]);
    });
    persistirEnDisco();
    console.log("⚙️  Configuración inicial cargada.");
  }

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
    creado_en     TEXT    DEFAULT (datetime('now', 'localtime')),
    ultimo_acceso TEXT
  )`);

  // ← NUEVA TABLA
  db.run(`CREATE TABLE IF NOT EXISTS cierres_caja (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha           TEXT    NOT NULL,
    cantidad_ventas INTEGER NOT NULL DEFAULT 0,
    monto_total     REAL    NOT NULL DEFAULT 0,
    total_efectivo  REAL    NOT NULL DEFAULT 0,
    total_vuelto    REAL    NOT NULL DEFAULT 0,
    notas           TEXT,
    admin_id        INTEGER,
    creado_en       TEXT    DEFAULT (datetime('now', 'localtime'))
  )`);

  console.log("✅ Tablas listas.");
  persistirEnDisco();

  const cp = get("SELECT COUNT(*) as c FROM productos");
  if (!cp || cp.c === 0) seedProductos();
  const cu = get("SELECT COUNT(*) as c FROM usuarios");
  if (!cu || cu.c === 0) seedAdmin();
}

function seedProductos() {
  [
    ["7790580000001","Coca Cola 500ml",850,48],
    ["7790580000002","Sprite 500ml",820,36],
    ["7791813000001","Agua Mineral Villavicencio 500ml",650,60],
    ["7790895000001","Alfajor Havanna x2",1200,24],
    ["7790040000001","Galletitas Oreo x3",950,30],
    ["7622300000001","Papas Fritas Lays 100g",780,20],
    ["7798062000001","Cigarrillos Marlboro x20",2800,15],
    ["7750789000001","Chicles Tic Tac Menta",450,50],
  ].forEach(([cb,n,p,s]) => db.run("INSERT INTO productos (codigo_barras,nombre,precio,stock) VALUES(?,?,?,?)",[cb,n,p,s]));
  persistirEnDisco();
  console.log("🌱 Productos de ejemplo cargados.");
}

function seedAdmin() {
  const hash = bcrypt.hashSync("admin123", 10);
  db.run("INSERT INTO usuarios (nombre,usuario,password_hash,rol) VALUES(?,?,?,?)",["Administrador","admin",hash,"admin"]);
  persistirEnDisco();
  console.log("👤 Usuario admin creado — usuario: admin | contraseña: admin123");
}

function getDb() {
  if (!db) throw new Error("BD no inicializada.");
  return { run, get, all, lastInsertRowid };
}

module.exports = { initDatabase, getDb };
