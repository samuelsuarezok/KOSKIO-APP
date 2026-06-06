// routes/config.js — Configuración del negocio

const express = require("express");
const router  = express.Router();
const { getDb }     = require("../db/database");
const { soloAdmin } = require("../middleware/auth");

// GET /api/config — leer toda la configuración (cualquier usuario autenticado)
// El frontend la necesita para armar el ticket
router.get("/", (req, res) => {
  try {
    const db   = getDb();
    const rows = db.all("SELECT clave, valor FROM configuracion ORDER BY clave ASC");
    // Convertir array [{clave, valor}] a objeto {clave: valor}
    const config = {};
    rows.forEach(r => { config[r.clave] = r.valor; });
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// PUT /api/config — guardar configuración (solo admin)
router.put("/", soloAdmin, (req, res) => {
  try {
    const db     = getDb();
    const campos = req.body; // { clave: valor, ... }

    const camposPermitidos = [
      "negocio_nombre", "negocio_direccion", "negocio_cuit",
      "negocio_telefono", "negocio_email", "ticket_mensaje",
      "punto_venta", "tipo_comprobante",
    ];

    let actualizados = 0;
    for (const [clave, valor] of Object.entries(campos)) {
      if (!camposPermitidos.includes(clave)) continue;
      db.run(
        `INSERT INTO configuracion (clave, valor, updated_at)
         VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, updated_at = excluded.updated_at`,
        [clave, String(valor).trim()]
      );
      actualizados++;
    }

    console.log(`⚙️  Configuración actualizada por ${req.usuario.nombre}: ${actualizados} campos.`);
    res.json({ success: true, mensaje: "Configuración guardada exitosamente.", actualizados });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
