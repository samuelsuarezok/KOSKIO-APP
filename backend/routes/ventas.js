// routes/ventas.js — con múltiples medios de pago

const express = require("express");
const router  = express.Router();

const { generarCAE } = require("../services/facturacionService");

const MEDIOS_PAGO_VALIDOS = ["efectivo", "debito", "credito", "transferencia", "qr"];

// POST /api/ventas
router.post("/", async (req, res) => {
  const { items, total, efectivo, vuelto, generar_factura, medio_pago } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ success: false, mensaje: "La venta debe tener al menos un ítem." });

  const medioPago = medio_pago || "efectivo";
  if (!MEDIOS_PAGO_VALIDOS.includes(medioPago))
    return res.status(400).json({ success: false, mensaje: `Medio de pago inválido: ${medioPago}` });

  // Vuelto solo aplica a efectivo
  const efectivoPagado = medioPago === "efectivo" ? (parseFloat(efectivo) || 0) : total;
  const vueltoCalculado = medioPago === "efectivo" ? (parseFloat(vuelto) || 0) : 0;

  if (medioPago === "efectivo" && efectivoPagado < total)
    return res.status(400).json({ success: false, mensaje: "El efectivo recibido es insuficiente." });

  try {
    const db = req.tenantDb;
    const usuario_id = req.usuario ? req.usuario.id : null;
    const facturar   = generar_factura === true;

    // 1. Verificar stock
    for (const item of items) {
      const prod = db.get("SELECT id, nombre, stock FROM productos WHERE id = ?", [item.producto_id]);
      if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado.`);
      if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente para "${prod.nombre}".`);
    }

    // 2. Insertar venta
    db.run(
      `INSERT INTO ventas (total, efectivo, vuelto, medio_pago, estado, usuario_id, facturada)
       VALUES (?, ?, ?, ?, 'procesando', ?, ?)`,
      [total, efectivoPagado, vueltoCalculado, medioPago, usuario_id, facturar ? 1 : 0]
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

    // 5. Generar CAE si corresponde
    const resultadoCAE = await generarCAE({ venta_id: ventaId, total, items, generar_factura: facturar });

    // 6. Actualizar estado
    if (resultadoCAE) {
      db.run("UPDATE ventas SET cae=?, cae_vto=?, estado='completada' WHERE id=?",
        [resultadoCAE.cae, resultadoCAE.cae_fch_vto, ventaId]);
    } else {
      db.run("UPDATE ventas SET estado='completada' WHERE id=?", [ventaId]);
    }

    // 7. Verificar alertas de stock bajo
    const alertasStock = [];
    for (const item of items) {
      const prod = db.get("SELECT nombre, stock, stock_minimo FROM productos WHERE id = ?", [item.producto_id]);
      if (prod && prod.stock <= prod.stock_minimo) {
        alertasStock.push({ nombre: prod.nombre, stock: prod.stock, stock_minimo: prod.stock_minimo });
      }
    }

    res.status(201).json({
      success: true,
      mensaje: facturar ? "Venta procesada y facturada." : "Venta procesada.",
      data: {
        venta_id: ventaId, total,
        efectivo: efectivoPagado, vuelto: vueltoCalculado,
        medio_pago: medioPago,
        facturada: facturar,
        cae:             resultadoCAE?.cae             || null,
        cae_vto:         resultadoCAE?.cae_fch_vto     || null,
        nro_comprobante: resultadoCAE?.nro_comprobante  || null,
        tipo_comprobante:resultadoCAE?.tipo_comprobante || null,
        punto_venta:     resultadoCAE?.punto_venta      || null,
      },
      alertas_stock: alertasStock,
    });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET /api/ventas
router.get("/", (req, res) => {
  try {
    const db = req.tenantDb;
    const limite = Math.min(parseInt(req.query.limite) || 50, 200);
    const pagina = Math.max(parseInt(req.query.pagina) || 1, 1);
    const offset = (pagina - 1) * limite;
    const { desde, hasta } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (desde) { where += " AND date(v.creado_en) >= ?"; params.push(desde); }
    if (hasta) { where += " AND date(v.creado_en) <= ?"; params.push(hasta); }

    const rows = db.all(
      `SELECT v.*, u.nombre as cajero_nombre FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id
       ${where} ORDER BY v.creado_en DESC LIMIT ? OFFSET ?`,
      [...params, limite, offset]
    );
    const countRow = db.get(`SELECT COUNT(*) as total FROM ventas v ${where}`, params);
    const resumen  = db.get(
      `SELECT COUNT(*) as cantidad_ventas, COALESCE(SUM(total),0) as monto_total
       FROM ventas v ${where}`, params
    );
    res.json({
      success: true, data: rows,
      paginacion: { total: countRow?.total || 0, pagina, limite, paginas: Math.ceil((countRow?.total || 0) / limite) },
      resumen,
    });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// GET /api/ventas/:id
router.get("/:id", (req, res) => {
  try {
    const db = req.tenantDb;
    const venta = db.get(
      `SELECT v.*, u.nombre as cajero_nombre FROM ventas v
       LEFT JOIN usuarios u ON v.usuario_id = u.id WHERE v.id = ?`, [req.params.id]
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
