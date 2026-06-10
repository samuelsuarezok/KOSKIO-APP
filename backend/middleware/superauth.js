// middleware/superauth.js — Autenticación exclusiva para superadmin

const jwt     = require("jsonwebtoken");
const bcrypt  = require("bcryptjs");
const { getMasterDb } = require("../db/masterDb");

const SA_SECRET = process.env.SA_SECRET || process.env.JWT_SECRET || "koskio_superadmin_secret_2024";

/**
 * Genera un token de superadmin.
 */
function generarTokenSA(superadmin) {
  return jwt.sign(
    { id: superadmin.id, nombre: superadmin.nombre, usuario: superadmin.usuario, role: "superadmin" },
    SA_SECRET,
    { expiresIn: "8h" }
  );
}

/**
 * Middleware que verifica que el request viene de un superadmin.
 */
function verificarSuperAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, mensaje: "Token de superadmin requerido." });
  }
  try {
    const decoded = jwt.verify(authHeader.split(" ")[1], SA_SECRET);
    if (decoded.role !== "superadmin") throw new Error("No es superadmin.");
    req.superadmin = decoded;
    next();
  } catch (_) {
    return res.status(401).json({ success: false, mensaje: "Token inválido o expirado." });
  }
}

module.exports = { generarTokenSA, verificarSuperAdmin, SA_SECRET };
