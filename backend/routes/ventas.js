const express = require("express");
const router = express.Router();
const { getDb } = require("../db/database");
const { generarCAE } = require("../services/facturacionService");

// POST /api/ventas — procesar venta
router.post("/", async (req, res) => {
  const { items, total, efectivo, vuelto } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ success: false, mensaje: "La venta debe tener al menos un ítem" });
  if (efectivo < total)
    return res.status(400).json({ success: false, mensaje: "El efectivo recibido es insuficiente" });
  try {
    const db = getDb();
    for (const item of items) {
      const prod = db.get("SELECT id, nombre, stock FROM productos WHERE id = ?", [item.producto_id]);
      if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado`);
      if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente para "${prod.nombre}"`);
    }
    // Guardar usuario_id del token si viene en req.usuario
    const usuario_id = req.usuario ? req.usuario.id : null;
    db.run("INSERT INTO ventas (total, efectivo, vuelto, estado, usuario_id) VALUES (?, ?, ?, 'procesando', ?)",
      [total, efectivo, vuelto, usuario_id]);
    const ventaId = db.lastInsertRowid();
    for (const item of items) {
      db.run("INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, subtotal) VALUES (?,?,?,?,?)",
        [ventaId, item.producto_id, item.cantidad, item.precio_unit, item.subtotal]);
    }
    for (const item of items) {
      db.run("UPDATE productos SET stock = stock - ?, actualizado_en = datetime('now','localtime') WHERE id = ?",
        [item.cantidad, item.producto_id]);
    }
    console.log(`\n💰 Venta #${ventaId} registrada. Facturando...`);
    const cae = await generarCAE({ venta_id: ventaId, total, items });
    db.run("UPDATE ventas SET cae=?, cae_vto=?, estado='completada' WHERE id=?",
      [cae.cae, cae.cae_fch_vto, ventaId]);
    res.status(201).json({ success: true, mensaje: "Venta procesada", data: { venta_id: ventaId, total, efectivo, vuelto, cae: cae.cae, cae_vto: cae.cae_fch_vto, nro_comprobante: cae.nro_comprobante, tipo_comprobante: cae.tipo_comprobante, punto_venta: cae.punto_venta } });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET /api/ventas — historial con filtros opcionales
// Query params: desde (YYYY-MM-DD), hasta (YYYY-MM-DD), limite, pagina
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const limite  = Math.min(parseInt(req.query.limite) || 50, 200);
    const pagina  = Math.max(parseInt(req.query.pagina) || 1, 1);
    const offset  = (pagina - 1) * limite;
    const { desde, hasta } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (desde)  { where += " AND date(v.creado_en) >= ?"; params.push(desde); }
    if (hasta)  { where += " AND date(v.creado_en) <= ?"; params.push(hasta); }

    // JOIN con usuarios para mostrar nombre del cajero
    const sql = `
      SELECT v.*, u.nombre as cajero_nombre
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      ${where}
      ORDER BY v.creado_en DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limite, offset);
    const rows = db.all(sql, params);

    // Total de registros para paginación
    const countSql = `SELECT COUNT(*) as total FROM ventas v ${where}`;
    const countRow = db.get(countSql, params.slice(0, params.length - 2));
    const total = countRow ? countRow.total : 0;

    // Resumen del período
    const resumenSql = `
      SELECT
        COUNT(*)   as cantidad_ventas,
        SUM(total) as monto_total,
        SUM(vuelto) as total_vuelto
      FROM ventas v ${where}
    `;
    const resumen = db.get(resumenSql, params.slice(0, params.length - 2));

    res.json({
      success: true,
      data: rows,
      paginacion: { total, pagina, limite, paginas: Math.ceil(total / limite) },
      resumen: {
        cantidad_ventas: resumen ? resumen.cantidad_ventas : 0,
        monto_total:     resumen ? resumen.monto_total || 0 : 0,
      }
    });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// GET /api/ventas/:id — detalle completo de una venta con sus ítems
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const venta = db.get(`
      SELECT v.*, u.nombre as cajero_nombre
      FROM ventas v
      LEFT JOIN usuarios u ON v.usuario_id = u.id
      WHERE v.id = ?
    `, [req.params.id]);
    if (!venta) return res.status(404).json({ success: false, mensaje: "Venta no encontrada" });

    const items = db.all(`
      SELECT vi.*, p.nombre as producto_nombre, p.codigo_barras
      FROM venta_items vi
      JOIN productos p ON vi.producto_id = p.id
      WHERE vi.venta_id = ?
    `, [req.params.id]);

    res.json({ success: true, data: { ...venta, items } });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

module.exports = router;
