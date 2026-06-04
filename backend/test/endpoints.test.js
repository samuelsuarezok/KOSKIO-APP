// test/endpoints.test.js — Tests de integración de la API Express.
// Runner nativo:  npm test   (node --test)
//
// Aislamiento: se fija KOSKIO_DB_PATH a un archivo temporal ANTES de requerir
// el módulo de BD, así la suite corre contra una DB descartable y NUNCA toca el
// pos_data.db real. El archivo temporal se borra al terminar.

const os   = require("node:os");
const path = require("node:path");
const fs   = require("node:fs");

// ⚠ Debe setearse ANTES de requerir db/database (lee DB_PATH al cargarse).
const TEST_DB = path.join(os.tmpdir(), "koskio_endpoints_test.db");
process.env.KOSKIO_DB_PATH = TEST_DB;
fs.rmSync(TEST_DB, { force: true });

// JWT_SECRET fijo y determinístico para los tests (lo lee middleware/auth al cargarse).
process.env.JWT_SECRET = "koskio-test-secret-determinista-1234";

const { test, before, after } = require("node:test");
const assert  = require("node:assert/strict");
const express = require("express");
const cors    = require("cors");

const { initDatabase }   = require("../db/database");
const { verificarToken } = require("../middleware/auth");

// ── App de test: espeja el wiring de /api de server.js (sin estáticos) ─────────
function construirApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api/auth",      require("../routes/auth"));
  app.use("/api/productos", verificarToken, require("../routes/productos"));
  app.use("/api/ventas",    verificarToken, require("../routes/ventas"));
  app.use("/api/caja",      verificarToken, require("../routes/caja"));
  app.use("/api/backup",    verificarToken, require("../routes/backup"));
  return app;
}

let server, base;

before(async () => {
  await initDatabase();                 // crea la DB fresca (con seed: admin + 8 productos)
  server = construirApp().listen(0);     // puerto efímero
  await new Promise(r => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  if (server) server.close();
  fs.rmSync(TEST_DB, { force: true });
});

// Helper de request
async function req(method, ruta, { token, body } = {}) {
  const res = await fetch(base + ruta, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data };
}

async function loginAdmin() {
  const { data } = await req("POST", "/api/auth/login", { body: { usuario: "admin", password: "admin123" } });
  return data.token;
}

// ══ AUTH ═════════════════════════════════════════════════════════════════════
test("auth: login con credenciales válidas devuelve token y datos", async () => {
  const { status, data } = await req("POST", "/api/auth/login", { body: { usuario: "admin", password: "admin123" } });
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.ok(data.token, "debe venir un token");
  assert.equal(data.usuario.rol, "admin");
});

test("auth: login con password incorrecta devuelve 401", async () => {
  const { status, data } = await req("POST", "/api/auth/login", { body: { usuario: "admin", password: "mala" } });
  assert.equal(status, 401);
  assert.equal(data.success, false);
});

test("auth: ruta protegida sin token devuelve 401", async () => {
  const { status } = await req("GET", "/api/productos");
  assert.equal(status, 401);
});

test("auth: ruta protegida con token inválido devuelve 401", async () => {
  const { status } = await req("GET", "/api/productos", { token: "token.basura.invalido" });
  assert.equal(status, 401);
});

// ══ ROLES (soloAdmin) ════════════════════════════════════════════════════════
test("roles: un cajero NO puede acceder al cierre de caja (403)", async () => {
  const adminToken = await loginAdmin();

  // Crear un cajero
  await req("POST", "/api/auth/usuarios", {
    token: adminToken,
    body: { nombre: "Caja Uno", usuario: "cajero1", password: "cajero123", rol: "cajero" },
  });

  // Loguearse como cajero
  const { data: loginCajero } = await req("POST", "/api/auth/login", { body: { usuario: "cajero1", password: "cajero123" } });
  assert.equal(loginCajero.usuario.rol, "cajero");

  // Intentar el cierre de caja → 403
  const { status } = await req("GET", "/api/caja/resumen", { token: loginCajero.token });
  assert.equal(status, 403);
});

test("seguridad: rechaza crear usuario con contraseña débil (< 8 chars)", async () => {
  const token = await loginAdmin();
  const { status, data } = await req("POST", "/api/auth/usuarios", {
    token, body: { nombre: "Débil", usuario: "debilucho", password: "123", rol: "cajero" },
  });
  assert.equal(status, 400);
  assert.match(data.mensaje, /8 caracteres/);
});

// ══ PRODUCTOS ════════════════════════════════════════════════════════════════
test("productos: crear y rechazar código de barras duplicado (409)", async () => {
  const token = await loginAdmin();

  const crear = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "999000111", nombre: "Producto Test", precio: 500, stock: 10 },
  });
  assert.equal(crear.status, 201);
  assert.ok(crear.data.data.id > 0, "el id creado no debe ser 0");

  const dup = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "999000111", nombre: "Otro", precio: 700, stock: 5 },
  });
  assert.equal(dup.status, 409);
});

// ══ VENTAS ═══════════════════════════════════════════════════════════════════
test("ventas: venta sin factura se completa y descuenta stock", async () => {
  const token = await loginAdmin();

  // Producto dedicado con stock conocido
  const { data: pCrea } = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "888000222", nombre: "Sin Factura", precio: 1000, stock: 5 },
  });
  const prodId = pCrea.data.id;

  const venta = await req("POST", "/api/ventas", {
    token,
    body: {
      items: [{ producto_id: prodId, cantidad: 2, precio_unit: 1000, subtotal: 2000 }],
      total: 2000, efectivo: 2000, vuelto: 0, generar_factura: false,
    },
  });
  assert.equal(venta.status, 201);
  assert.equal(venta.data.data.facturada, false);
  assert.ok(venta.data.data.venta_id > 0, "venta_id no debe ser 0");

  // Stock descontado: 5 - 2 = 3
  const { data: pAhora } = await req("GET", `/api/productos/${prodId}`, { token });
  assert.equal(pAhora.data.stock, 3);
});

test("ventas: stock insuficiente es rechazado", async () => {
  const token = await loginAdmin();
  const { data: pCrea } = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "777000333", nombre: "Poco Stock", precio: 300, stock: 1 },
  });
  const prodId = pCrea.data.id;

  const venta = await req("POST", "/api/ventas", {
    token,
    body: {
      items: [{ producto_id: prodId, cantidad: 5, precio_unit: 300, subtotal: 1500 }],
      total: 1500, efectivo: 2000, vuelto: 500, generar_factura: false,
    },
  });
  assert.equal(venta.status, 500);
  assert.equal(venta.data.success, false);
  assert.match(venta.data.mensaje, /[Ss]tock/);
});

test("ventas: ATÓMICA — si un ítem falla, NO se descuenta stock de los otros ni se registra la venta", async () => {
  const token = await loginAdmin();

  // Producto A: stock de sobra. Producto B: stock insuficiente.
  const { data: a } = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "555000111", nombre: "Atomico A", precio: 100, stock: 20 },
  });
  const { data: b } = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "555000222", nombre: "Atomico B", precio: 100, stock: 1 },
  });
  const idA = a.data.id, idB = b.data.id;

  // Cuántas ventas hay antes
  const { data: antes } = await req("GET", "/api/ventas?limite=200", { token });
  const ventasAntes = antes.paginacion.total;

  // Venta con A (ok) + B (sin stock) → debe fallar ENTERA
  const venta = await req("POST", "/api/ventas", {
    token,
    body: {
      items: [
        { producto_id: idA, cantidad: 2, precio_unit: 100, subtotal: 200 },
        { producto_id: idB, cantidad: 5, precio_unit: 100, subtotal: 500 },
      ],
      total: 700, efectivo: 1000, vuelto: 300, generar_factura: false,
    },
  });
  assert.equal(venta.status, 500);

  // El stock de A quedó INTACTO (no se descontó nada)
  const { data: aAhora } = await req("GET", `/api/productos/${idA}`, { token });
  assert.equal(aAhora.data.stock, 20, "el stock del ítem válido NO debe tocarse");

  // No se registró ninguna venta nueva
  const { data: despues } = await req("GET", "/api/ventas?limite=200", { token });
  assert.equal(despues.paginacion.total, ventasAntes, "no debe quedar venta fantasma");
});

// ══ REGRESIÓN: bug last_insert_rowid / export() ══════════════════════════════
// Antes del fix, la venta con factura quedaba en estado='procesando' con cae=null
// porque lastInsertRowid() devolvía 0 (db.export resetea last_insert_rowid).
test("REGRESIÓN: venta con factura queda 'completada' con CAE persistido", async () => {
  const token = await loginAdmin();
  const { data: pCrea } = await req("POST", "/api/productos", {
    token, body: { codigo_barras: "666000444", nombre: "Facturable", precio: 650, stock: 10 },
  });
  const prodId = pCrea.data.id;

  const venta = await req("POST", "/api/ventas", {
    token,
    body: {
      items: [{ producto_id: prodId, cantidad: 2, precio_unit: 650, subtotal: 1300 }],
      total: 1300, efectivo: 5000, vuelto: 3700, generar_factura: true,
    },
  });
  assert.equal(venta.status, 201);
  const ventaId = venta.data.data.venta_id;
  assert.ok(ventaId > 0, "venta_id no debe ser 0 (regresión rowid)");
  assert.ok(venta.data.data.cae, "debe devolver CAE");

  // Lo que REALMENTE quedó guardado en la DB
  const { data: detalle } = await req("GET", `/api/ventas/${ventaId}`, { token });
  assert.equal(detalle.data.estado, "completada", "no debe quedar en 'procesando'");
  assert.equal(detalle.data.facturada, 1);
  assert.ok(detalle.data.cae, "el CAE debe estar persistido, no null");
});
