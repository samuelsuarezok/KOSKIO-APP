// routes/caja.js — Cierre de caja (admin y cajero)

const express = require("express");
const router  = express.Router();
const { getDb }      = require("../db/database");
const { soloAdmin }  = require("../middleware/auth");

// GET /api/caja/resumen — Resumen del día (admin y cajero)
router.get("/resumen", (req, res) => {
  try {
    const db    = getDb();
    const fecha = req.query.fecha || new Date().toISOString().split("T")[0];
    const esAdmin = req.usuario.rol === "admin";

    const totales = db.get(`
      SELECT
        COUNT(*)                   AS cantidad_ventas,
        COALESCE(SUM(total),    0) AS monto_total,
        COALESCE(SUM(efectivo), 0) AS total_efectivo,
        COALESCE(SUM(vuelto),   0) AS total_vuelto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
        ${!esAdmin ? "AND usuario_id = ?" : ""}
    `, esAdmin ? [fecha] : [fecha, req.usuario.id]);

    // El cajero solo ve sus propias ventas en los KPIs
    // El admin ve todos los cajeros
    const porCajero = esAdmin ? db.all(`
      SELECT
        COALESCE(u.nombre, 'Sin asignar') AS cajero,
        COUNT(v.id)                        AS cantidad,
        COALESCE(SUM(v.total), 0)          AS monto
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      WHERE date(v.creado_en) = ? AND v.estado = 'completada'
      GROUP BY v.usuario_id ORDER BY monto DESC
    `, [fecha]) : [];

    const topProductos = db.all(`
      SELECT
        p.nombre,
        SUM(vi.cantidad)  AS unidades,
        SUM(vi.subtotal)  AS total_vendido
      FROM venta_items vi
      JOIN productos p ON vi.producto_id = p.id
      JOIN ventas v    ON vi.venta_id    = v.id
      WHERE date(v.creado_en) = ? AND v.estado = 'completada'
        ${!esAdmin ? "AND v.usuario_id = ?" : ""}
      GROUP BY vi.producto_id
      ORDER BY unidades DESC LIMIT 5
    `, esAdmin ? [fecha] : [fecha, req.usuario.id]);

    const porHora = db.all(`
      SELECT
        CAST(strftime('%H', creado_en) AS INTEGER) AS hora,
        COUNT(*)                   AS cantidad,
        COALESCE(SUM(total), 0)    AS monto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
        ${!esAdmin ? "AND usuario_id = ?" : ""}
      GROUP BY hora ORDER BY hora ASC
    `, esAdmin ? [fecha] : [fecha, req.usuario.id]);

    // Cierre: el cajero solo ve si él mismo cerró (no ve cierres de otros)
    const cierreExistente = db.get(`
      SELECT * FROM cierres_caja
      WHERE fecha = ? ${!esAdmin ? "AND admin_id = ?" : ""}
      ORDER BY id DESC LIMIT 1
    `, esAdmin ? [fecha] : [fecha, req.usuario.id]);

    res.json({
      success: true,
      fecha,
      esAdmin,
      data: { totales, porCajero, topProductos, porHora, cierreExistente: cierreExistente || null },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// POST /api/caja/cerrar — Registrar cierre (admin y cajero)
router.post("/cerrar", (req, res) => {
  try {
    const db    = getDb();
    const fecha = req.query.fecha || new Date().toISOString().split("T")[0];
    const { notas } = req.body;
    const esAdmin   = req.usuario.rol === "admin";

    // Calcular totales según el rol
    const totales = db.get(`
      SELECT
        COUNT(*)                   AS cantidad_ventas,
        COALESCE(SUM(total),    0) AS monto_total,
        COALESCE(SUM(efectivo), 0) AS total_efectivo,
        COALESCE(SUM(vuelto),   0) AS total_vuelto
      FROM ventas
      WHERE date(creado_en) = ? AND estado = 'completada'
        ${!esAdmin ? "AND usuario_id = ?" : ""}
    `, esAdmin ? [fecha] : [fecha, req.usuario.id]);

    db.run(`
      INSERT INTO cierres_caja
        (fecha, cantidad_ventas, monto_total, total_efectivo, total_vuelto, notas, admin_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [fecha, totales.cantidad_ventas, totales.monto_total,
        totales.total_efectivo, totales.total_vuelto,
        notas || null, req.usuario.id]);

    const id = db.lastInsertRowid();
    console.log(`🔒 Cierre registrado — ${fecha} | $${totales.monto_total} | ${req.usuario.nombre} (${req.usuario.rol})`);

    res.status(201).json({
      success: true,
      mensaje: `Cierre del ${fecha} registrado exitosamente.`,
      data: { id, fecha, ...totales },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// GET /api/caja/historial — Solo admin
router.get("/historial", soloAdmin, (req, res) => {
  try {
    const db     = getDb();
    const limite = parseInt(req.query.limite) || 30;
    const cierres = db.all(`
      SELECT c.*, u.nombre AS admin_nombre
      FROM cierres_caja c
      LEFT JOIN usuarios u ON c.admin_id = u.id
      ORDER BY c.fecha DESC, c.id DESC LIMIT ?
    `, [limite]);
    res.json({ success: true, data: cierres });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
