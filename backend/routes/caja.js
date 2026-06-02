// routes/caja.js — Cierre de caja diario (solo admin)

const express = require("express");
const router = express.Router();
const { getDb } = require("../db/database");
const { soloAdmin } = require("../middleware/auth");

// ─── GET /api/caja/resumen — Resumen del día (o período) ──────────────────────
// Query params: fecha (YYYY-MM-DD), por defecto hoy
router.get("/resumen", soloAdmin, (req, res) => {
  try {
    const db = getDb();
    const fecha = req.query.fecha || new Date().toISOString().split("T")[0];

    // Totales generales del día
    const totales = db.get(`
      SELECT
        COUNT(*)        AS cantidad_ventas,
        COALESCE(SUM(total),    0) AS monto_total,
        COALESCE(SUM(efectivo), 0) AS total_efectivo,
        COALESCE(SUM(vuelto),   0) AS total_vuelto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
    `, [fecha]);

    // Desglose por cajero
    const porCajero = db.all(`
      SELECT
        COALESCE(u.nombre, 'Sin asignar') AS cajero,
        COUNT(v.id)        AS cantidad,
        COALESCE(SUM(v.total), 0) AS monto
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      WHERE date(v.creado_en) = ? AND v.estado = 'completada'
      GROUP BY v.usuario_id
      ORDER BY monto DESC
    `, [fecha]);

    // Top 5 productos más vendidos
    const topProductos = db.all(`
      SELECT
        p.nombre,
        SUM(vi.cantidad)  AS unidades,
        SUM(vi.subtotal)  AS total_vendido
      FROM venta_items vi
      JOIN productos p    ON vi.producto_id = p.id
      JOIN ventas v       ON vi.venta_id    = v.id
      WHERE date(v.creado_en) = ? AND v.estado = 'completada'
      GROUP BY vi.producto_id
      ORDER BY unidades DESC
      LIMIT 5
    `, [fecha]);

    // Ventas por hora (para el gráfico de barras)
    const porHora = db.all(`
      SELECT
        CAST(strftime('%H', creado_en) AS INTEGER) AS hora,
        COUNT(*)        AS cantidad,
        COALESCE(SUM(total), 0) AS monto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
      GROUP BY hora
      ORDER BY hora ASC
    `, [fecha]);

    // Ver si ya existe un cierre para esta fecha
    const cierreExistente = db.get(`
      SELECT * FROM cierres_caja WHERE fecha = ? ORDER BY id DESC LIMIT 1
    `, [fecha]);

    res.json({
      success: true,
      fecha,
      data: {
        totales,
        porCajero,
        topProductos,
        porHora,
        cierreExistente: cierreExistente || null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/caja/cerrar — Registrar cierre de caja ────────────────────────
router.post("/cerrar", soloAdmin, (req, res) => {
  try {
    const db = getDb();
    const fecha = req.query.fecha || new Date().toISOString().split("T")[0];
    const { notas } = req.body;
    const admin_id = req.usuario.id;

    // Calcular totales del día para guardarlos en el cierre
    const totales = db.get(`
      SELECT
        COUNT(*)        AS cantidad_ventas,
        COALESCE(SUM(total),    0) AS monto_total,
        COALESCE(SUM(efectivo), 0) AS total_efectivo,
        COALESCE(SUM(vuelto),   0) AS total_vuelto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
    `, [fecha]);

    db.run(`
      INSERT INTO cierres_caja
        (fecha, cantidad_ventas, monto_total, total_efectivo, total_vuelto, notas, admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      fecha,
      totales.cantidad_ventas,
      totales.monto_total,
      totales.total_efectivo,
      totales.total_vuelto,
      notas || null,
      admin_id,
    ]);

    const id = db.lastInsertRowid();
    console.log(`🔒 Cierre de caja registrado — Fecha: ${fecha} | Total: $${totales.monto_total} | Por: ${req.usuario.nombre}`);

    res.status(201).json({
      success: true,
      mensaje: `Cierre de caja del ${fecha} registrado exitosamente.`,
      data: { id, fecha, ...totales },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/caja/historial — Historial de cierres ──────────────────────────
router.get("/historial", soloAdmin, (req, res) => {
  try {
    const db = getDb();
    const limite = parseInt(req.query.limite) || 30;

    const cierres = db.all(`
      SELECT c.*, u.nombre AS admin_nombre
      FROM cierres_caja c
      LEFT JOIN usuarios u ON c.admin_id = u.id
      ORDER BY c.fecha DESC, c.id DESC
      LIMIT ?
    `, [limite]);

    res.json({ success: true, data: cierres });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
