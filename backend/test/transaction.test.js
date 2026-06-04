// test/transaction.test.js — Prueba que db.transaction() sea atómico (todo-o-nada).
// Es la red que blinda la integridad de la venta: si algo falla a mitad de
// camino, NADA debe quedar escrito.

const os   = require("node:os");
const path = require("node:path");
const fs   = require("node:fs");

// DB temporal propia (otro nombre que endpoints.test.js: node --test aísla cada
// archivo en su proceso, pero deben usar archivos distintos por las dudas).
const TEST_DB = path.join(os.tmpdir(), "koskio_transaction_test.db");
process.env.KOSKIO_DB_PATH = TEST_DB;
fs.rmSync(TEST_DB, { force: true });

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { initDatabase, getDb } = require("../db/database");

let db;
before(async () => { await initDatabase(); db = getDb(); });
after(() => { fs.rmSync(TEST_DB, { force: true }); });

test("transaction: COMMIT persiste todas las escrituras", () => {
  db.transaction((tx) => {
    tx.run("INSERT INTO productos (codigo_barras, nombre, precio, stock) VALUES (?,?,?,?)",
      ["TX-OK-1", "Commit Test", 100, 5]);
  });
  const prod = db.get("SELECT * FROM productos WHERE codigo_barras = ?", ["TX-OK-1"]);
  assert.ok(prod, "el producto debe existir tras el commit");
  assert.equal(prod.stock, 5);
});

test("transaction: ROLLBACK revierte TODO si el callback lanza", () => {
  // Producto base ya confirmado
  db.run("INSERT INTO productos (codigo_barras, nombre, precio, stock) VALUES (?,?,?,?)",
    ["TX-ROLL-1", "Rollback Test", 200, 10]);
  const id = db.lastInsertRowid();

  // Transacción que descuenta stock y LUEGO falla → debe revertirse entera
  assert.throws(() => {
    db.transaction((tx) => {
      tx.run("UPDATE productos SET stock = stock - 4 WHERE id = ?", [id]);
      // dentro de la tx el cambio se ve...
      const dentro = tx.get("SELECT stock FROM productos WHERE id = ?", [id]);
      assert.equal(dentro.stock, 6);
      throw new Error("simular fallo a mitad de la venta");
    });
  }, /simular fallo/);

  // ...pero afuera el stock quedó INTACTO en 10 (rollback)
  const despues = db.get("SELECT stock FROM productos WHERE id = ?", [id]);
  assert.equal(despues.stock, 10, "el stock debe volver a su valor original");
});

test("transaction: el ROLLBACK no deja filas a medio insertar", () => {
  const antes = db.get("SELECT COUNT(*) AS c FROM productos").c;
  assert.throws(() => {
    db.transaction((tx) => {
      tx.run("INSERT INTO productos (codigo_barras, nombre, precio, stock) VALUES (?,?,?,?)",
        ["TX-GHOST", "Fantasma", 50, 1]);
      throw new Error("abortar");
    });
  });
  const despues = db.get("SELECT COUNT(*) AS c FROM productos").c;
  assert.equal(despues, antes, "no debe quedar ninguna fila fantasma");
  assert.equal(db.get("SELECT id FROM productos WHERE codigo_barras = ?", ["TX-GHOST"]), null);
});
