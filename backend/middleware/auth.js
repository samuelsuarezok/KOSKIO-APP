// middleware/auth.js
// Middleware de autenticación JWT — protege todas las rutas de la API

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "pos_argentina_secret_2024_cambiar_en_produccion";

/**
 * Verifica que el request tenga un token JWT válido.
 * Si el token es válido, agrega req.usuario con los datos del usuario logueado.
 */
function verificarToken(req, res, next) {
  const authHeader = req.headers["authorization"];

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, mensaje: "Acceso denegado. Token no proporcionado." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.usuario = decoded; // { id, nombre, rol }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, mensaje: "Token inválido o expirado. Iniciá sesión nuevamente." });
  }
}

/**
 * Middleware que solo permite acceso a administradores.
 * Usar DESPUÉS de verificarToken.
 */
function soloAdmin(req, res, next) {
  if (req.usuario.rol !== "admin") {
    return res.status(403).json({ success: false, mensaje: "Acceso denegado. Se requiere rol de administrador." });
  }
  next();
}

module.exports = { verificarToken, soloAdmin, JWT_SECRET };
