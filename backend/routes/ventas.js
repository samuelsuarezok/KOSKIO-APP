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

    // 1. Generar el CAE ANTES de tocar la BD. Es la parte lenta y que puede
    //    fallar (AFIP). Si falla, lanzamos y NO se registra ninguna venta.
    const resultadoCAE = await generarCAE({ total, items, generar_factura: facturar });

    // 2. Persistir venta + ítems + stock de forma ATÓMICA (todo-o-nada).
    //    El callback es 100% síncrono: no hay await adentro, así que ninguna
    //    otra request se intercala entre el chequeo de stock y el descuento.
    const ventaId = db.transaction((tx) => {
      // Validar stock DENTRO de la transacción (consistencia bajo concurrencia)
      for (const item of items) {
        const prod = tx.get("SELECT id, nombre, stock FROM productos WHERE id = ?", [item.producto_id]);
        if (!prod) throw new Error(`Producto ID ${item.producto_id} no encontrado.`);
        if (prod.stock < item.cantidad) throw new Error(`Stock insuficiente para "${prod.nombre}".`);
      }

      // La venta nace COMPLETADA, con el CAE ya resuelto (o null si no se facturó).
      tx.run(
        "INSERT INTO ventas (total, efectivo, vuelto, cae, cae_vto, estado, usuario_id, facturada) VALUES (?, ?, ?, ?, ?, 'completada', ?, ?)",
        [total, efectivo, vuelto,
         resultadoCAE ? resultadoCAE.cae : null,
         resultadoCAE ? resultadoCAE.cae_fch_vto : null,
         usuario_id, facturar ? 1 : 0]
      );
      const id = tx.lastInsertRowid();

      for (const item of items) {
        tx.run(
          "INSERT INTO venta_items (venta_id, producto_id, cantidad, precio_unit, subtotal) VALUES (?,?,?,?,?)",
          [id, item.producto_id, item.cantidad, item.precio_unit, item.subtotal]
        );
      }
      for (const item of items) {
        tx.run(
          "UPDATE productos SET stock = stock - ?, actualizado_en = datetime('now','localtime') WHERE id = ?",
          [item.cantidad, item.producto_id]
        );
      }
      return id;
    });

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
