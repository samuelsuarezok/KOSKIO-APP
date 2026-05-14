// db/database.js
// Módulo de base de datos usando sql.js (SQLite puro en WebAssembly)
// No requiere compilación nativa — funciona en cualquier entorno Node.js

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "pos_data.db");

let db = null;
let SQL = null;

function persistirEnDisco() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error("⚠ Error al persistir la base de datos:", err.message);
  }
}

function run(sql, params = []) {
  db.run(sql, params);
  persistirEnDisco();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const results = db.exec(sql, params);
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

function lastInsertRowid() {
  const row = get("SELECT last_insert_rowid() as id");
  return row ? row.id : null;
}

async function initDatabase() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log("✅ Base de datos cargada desde:", DB_PATH);
  } else {
    db = new SQL.Database();
    console.log("✅ Nueva base de datos SQLite creada.");
  }

  db.run("PRAGMA journal_mode = WAL");

  db.run(`CREATE TABLE IF NOT EXISTS productos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_barras   TEXT    NOT NULL UNIQUE,
    nombre          TEXT    NOT NULL,
    precio          REAL    NOT NULL,
    stock           INTEGER NOT NULL DEFAULT 0,
    creado_en       TEXT    DEFAULT (datetime('now', 'localtime')),
    actualizado_en  TEXT    DEFAULT (datetime('now', 'localtime'))
  )`);
  console.log("✅ Tabla 'productos' lista.");

  db.run(`CREATE TABLE IF NOT EXISTS ventas (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    total     REAL NOT NULL,
    efectivo  REAL NOT NULL,
    vuelto    REAL NOT NULL,
    cae       TEXT,
    cae_vto   TEXT,
    estado    TEXT DEFAULT 'completada',
    creado_en TEXT DEFAULT (datetime('now', 'localtime'))
  )`);
  console.log("✅ Tabla 'ventas' lista.");

  db.run(`CREATE TABLE IF NOT EXISTS venta_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id    INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad    INTEGER NOT NULL,
    precio_unit REAL    NOT NULL,
    subtotal    REAL    NOT NULL
  )`);
  console.log("✅ Tabla 'venta_items' lista.");

  persistirEnDisco();

  const count = get("SELECT COUNT(*) as c FROM productos");
  if (!count || count.c === 0) seedDatabase();
}

function seedDatabase() {
  const productos = [
    ["7790580000001", "Coca Cola 500ml", 850.00, 48],
    ["7790580000002", "Sprite 500ml", 820.00, 36],
    ["7791813000001", "Agua Mineral Villavicencio 500ml", 650.00, 60],
    ["7790895000001", "Alfajor Havanna x2", 1200.00, 24],
    ["7790040000001", "Galletitas Oreo x3", 950.00, 30],
    ["7622300000001", "Papas Fritas Lays 100g", 780.00, 20],
    ["7798062000001", "Cigarrillos Marlboro x20", 2800.00, 15],
    ["7750789000001", "Chicles Tic Tac Menta", 450.00, 50],
  ];
  productos.forEach(([cb, nombre, precio, stock]) => {
    db.run("INSERT INTO productos (codigo_barras, nombre, precio, stock) VALUES (?, ?, ?, ?)",
      [cb, nombre, precio, stock]);
  });
  persistirEnDisco();
  console.log("🌱 Base de datos sembrada con productos de ejemplo.");
}

function getDb() {
  if (!db) throw new Error("Base de datos no inicializada.");
  return { run, get, all, lastInsertRowid };
}

module.exports = { initDatabase, getDb };
