// routes/backup.js — Endpoints de backup (solo admin)

const express = require("express");
const router  = express.Router();
const { soloAdmin } = require("../middleware/auth");
const { hacerBackup, listarBackups } = require("../services/backupService");

// POST /api/backup — hacer backup manual ahora
router.post("/", soloAdmin, (req, res) => {
  const resultado = hacerBackup("manual desde panel");
  if (!resultado) {
    return res.status(500).json({ success: false, mensaje: "Error al generar el backup." });
  }
  res.json({
    success: true,
    mensaje: `Backup generado exitosamente: ${resultado.archivo}`,
    data: resultado,
  });
});

// GET /api/backup — listar todos los backups disponibles
router.get("/", soloAdmin, (req, res) => {
  const backups = listarBackups();
  res.json({ success: true, data: backups, total: backups.length });
});

module.exports = router;
