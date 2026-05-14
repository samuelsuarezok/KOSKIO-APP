// routes/ventas.js - Procesamiento de ventas con sql.js síncrono

const express = require("express");
const router = express.Router();
const { getDb } = require("../db/database");
const { generarCAE } = require("../services/facturacionService");

// POST /api/ventas — procesar una venta completa
router.post("/", async (req, res) => {
  const { items, total, efectivo, vuelto } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, mensaje: "La venta debe tener al menos un ítem" });
  }
  if (total === undefined || efectivo === undefined) {
    return res.status(400).json({ success: false, mensaje: "Faltan datos: total, efectivo" });
  }
  if (efectivo < total) {
    return res.status(400).json({ success: false, mensaje: "El efectivo recibido es insuficiente" });
  }

  try {
    const db = getDb();

    // 1. Verificar stock de todos los productos
    for (const item of items) {
      const prod = db.get("SELECT id, nombre, stock FROM productos WHERE id = ?", [item.producto_id]);
      if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado`);
      if (prod.stock < item.cantidad) {
        throw new Error(`Stock insuficiente para "${prod.nombre}" (disponible: ${prod.stock})`);
      }
    }

    // 2. Insertar la venta
    db.run(
      "INSERT INTO ventas (total, efectivo, vuelto, estado) VALUES (?, ?, ?, 'procesando')",
      [total, efectivo, vuelto]
    );
    const ventaId = db.lastInsertRowid();

    // 3. Insertar ítems
    for (const item of items) {
      db.run(
        "INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, subtotal) VALUES (?, ?, ?, ?, ?)",
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

    // 5. Generar CAE (mock AFIP)
    console.log(`\n💰 Venta #${ventaId} registrada. Iniciando facturación electrónica...`);
    const resultadoCAE = await generarCAE({ venta_id: ventaId, total, items });

    // 6. Actualizar venta con CAE
    db.run(
      "UPDATE ventas SET cae=?, cae_vto=?, estado='completada' WHERE id=?",
      [resultadoCAE.cae, resultadoCAE.cae_fch_vto, ventaId]
    );

    res.status(201).json({
      success: true,
      mensaje: "Venta procesada y facturada exitosamente",
      data: {
        venta_id: ventaId,
        total,
        efectivo,
        vuelto,
        cae: resultadoCAE.cae,
        cae_vto: resultadoCAE.cae_fch_vto,
        nro_comprobante: resultadoCAE.nro_comprobante,
        tipo_comprobante: resultadoCAE.tipo_comprobante,
        punto_venta: resultadoCAE.punto_venta,
      },
    });

  } catch (error) {
    console.error("❌ Error procesando venta:", error.message);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

// GET /api/ventas — historial de ventas
router.get("/", (req, res) => {
  try {
    const db = getDb();
    const limite = parseInt(req.query.limite) || 50;
    const rows = db.all("SELECT * FROM ventas ORDER BY creado_en DESC LIMIT ?", [limite]);
    const count = db.get("SELECT COUNT(*) as total FROM ventas");
    res.json({ success: true, data: rows, total: count ? count.total : 0 });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// GET /api/ventas/:id — detalle de una venta
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const venta = db.get("SELECT * FROM ventas WHERE id = ?", [req.params.id]);
    if (!venta) return res.status(404).json({ success: false, mensaje: "Venta no encontrada" });

    const items = db.all(
      `SELECT vi.*, p.nombre, p.codigo_barras 
       FROM venta_items vi JOIN productos p ON vi.producto_id = p.id 
       WHERE vi.venta_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...venta, items } });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
