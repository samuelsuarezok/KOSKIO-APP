const express = require("express");
const router = express.Router();
const { getDb } = require("../db/database");
const { generarCAE } = require("../services/facturacionService");

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
    db.run("INSERT INTO ventas (total, efectivo, vuelto, estado) VALUES (?, ?, ?, 'procesando')", [total, efectivo, vuelto]);
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
    db.run("UPDATE ventas SET cae=?, cae_vto=?, estado='completada' WHERE id=?", [cae.cae, cae.cae_fch_vto, ventaId]);
    res.status(201).json({ success: true, mensaje: "Venta procesada", data: { venta_id: ventaId, total, efectivo, vuelto, cae: cae.cae, cae_vto: cae.cae_fch_vto, nro_comprobante: cae.nro_comprobante, tipo_comprobante: cae.tipo_comprobante, punto_venta: cae.punto_venta } });
  } catch (error) {
    console.error("❌ Error:", error.message);
    res.status(500).json({ success: false, mensaje: error.message });
  }
});

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const rows = db.all("SELECT * FROM ventas ORDER BY creado_en DESC LIMIT 50");
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

module.exports = router;
