// routes/ventas.js — con soporte de facturación opcional

const express = require("express");
const router  = express.Router();
const { getDb }       = require("../db/database");
const { generarCAE }  = require("../services/facturacionService");

// POST /api/ventas — procesar venta (con o sin factura)
router.post("/", async (req, res) => {
  const { items, total, efectivo, vuelto, generar_factura } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ success: false, mensaje: "La venta debe tener al menos un ítem." });
  if (efectivo < total)
    return res.status(400).json({ success: false, mensaje: "El efectivo recibido es insuficiente." });

  try {
    const db         = getDb();
    const usuario_id = req.usuario ? req.usuario.id : null;
    const facturar   = generar_factura === true;

    // 1. Verificar stock
    for (const item of items) {
      const prod = db.get("SELECT id, nombre, stock FROM productos WHERE id = ?", [item.producto_id]);
      if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado.`);
      if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente para "${prod.nombre}".`);
    }

    // 2. Insertar venta con campo facturada
    db.run(
      "INSERT INTO ventas (total, efectivo, vuelto, estado, usuario_id, facturada) VALUES (?, ?, ?, 'procesando', ?, ?)",
      [total, efectivo, vuelto, usuario_id, facturar ? 1 : 0]
    );
    const ventaId = db.lastInsertRowid();

    // 3. Insertar ítems
    for (const item of items) {
      db.run(
        "INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, subtotal) VALUES (?,?,?,?,?)",
        [ventaId, item.producto_id, item.cantidad, item.precio_unit, item.subtotal]
      );
    }

    // 4. Descontar stock
    for (const item of items) {
      db.run(
        "UPDATE productos SET stock = stock - ?, actualizado_en = datetime('now','localtime') WHERE id = ?",
        [item.cantidad, item.producto_id]
      );
    }

    // 5. Generar CAE solo si el cajero lo pidió
    const resultadoCAE = await generarCAE({ venta_id: ventaId, total, items, generar_factura: facturar });

    // 6. Actualizar venta con resultado
    if (resultadoCAE) {
      db.run(
        "UPDATE ventas SET cae=?, cae_vto=?, estado='completada' WHERE id=?",
        [resultadoCAE.cae, resultadoCAE.cae_fch_vto, ventaId]
      );
    } else {
      db.run("UPDATE ventas SET estado='completada' WHERE id=?", [ventaId]);
    }

    res.status(201).json({
      success: true,
      mensaje: facturar ? "Venta procesada y facturada." : "Venta procesada sin factura.",
      data: {
        venta_id:        ventaId,
        total, efectivo, vuelto,
        facturada:       facturar,
        cae:             resultadoCAE ? resultadoCAE.cae             : null,
        cae_vto:         resultadoCAE ? resultadoCAE.cae_fch_vto     : null,
        nro_comprobante: resultadoCAE ? resultadoCAE.nro_comprobante : null,
        tipo_comprobante:resultadoCAE ? resultadoCAE.tipo_comprobante: null,
        punto_venta:     resultadoCAE ? resultadoCAE.punto_venta      : null,
      },
    });

  } catch (error) {
    console.error("❌ Error procesando venta:", error.message);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET /api/ventas — historial con filtros
router.get("/", (req, res) => {
  try {
    const db      = getDb();
    const limite  = Math.min(parseInt(req.query.limite) || 50, 200);
    const pagina  = Math.max(parseInt(req.query.pagina) || 1, 1);
    const offset  = (pagina - 1) * limite;
    const { desde, hasta } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (desde) { where += " AND date(v.creado_en) >= ?"; params.push(desde); }
    if (hasta) { where += " AND date(v.creado_en) <= ?"; params.push(hasta); }

    const rows = db.all(
      `SELECT v.*, u.nombre as cajero_nombre
       FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id
       ${where} ORDER BY v.creado_en DESC LIMIT ? OFFSET ?`,
      [...params, limite, offset]
    );

    const countRow = db.get(`SELECT COUNT(*) as total FROM ventas v ${where}`, params);
    const resumen  = db.get(
      `SELECT COUNT(*) as cantidad_ventas, COALESCE(SUM(total),0) as monto_total
       FROM ventas v ${where}`, params
    );

    res.json({
      success: true,
      data: rows,
      paginacion: { total: countRow ? countRow.total : 0, pagina, limite, paginas: Math.ceil((countRow ? countRow.total : 0) / limite) },
      resumen,
    });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// GET /api/ventas/:id — detalle completo
router.get("/:id", (req, res) => {
  try {
    const db    = getDb();
    const venta = db.get(
      `SELECT v.*, u.nombre as cajero_nombre
       FROM ventas v LEFT JOIN usuarios u ON v.usuario_id = u.id
       WHERE v.id = ?`, [req.params.id]
    );
    if (!venta) return res.status(404).json({ success: false, mensaje: "Venta no encontrada." });

    const items = db.all(
      `SELECT vi.*, p.nombre as producto_nombre, p.codigo_barras
       FROM venta_items vi JOIN productos p ON vi.producto_id = p.id
       WHERE vi.venta_id = ?`, [req.params.id]
    );
    res.json({ success: true, data: { ...venta, items } });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

module.exports = router;
