// middleware/auth.js
// Middleware de autenticación JWT — protege todas las rutas de la API

const jwt    = require("jsonwebtoken");
const crypto = require("crypto");

// Resuelve el secreto de firma de los JWT. NUNCA hay un fallback público en el
// código: con un secreto conocido cualquiera podría falsificar un token de admin.
//   - Si JWT_SECRET está en el entorno → se usa (se avisa si es muy corto).
//   - Si NO está y es producción → el server se niega a arrancar (inseguro).
//   - Si NO está y es desarrollo → secreto EFÍMERO aleatorio por arranque
//     (los tokens se invalidan al reiniciar; seteá JWT_SECRET para persistirlos).
function resolverJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 16) {
      console.warn("⚠ JWT_SECRET es muy corto (<16 caracteres). Usá uno largo y aleatorio.");
    }
    return fromEnv;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET no está configurado. Me niego a arrancar en producción con un " +
      "secreto inseguro. Seteá la variable de entorno JWT_SECRET (16+ caracteres)."
    );
  }
  const efimero = crypto.randomBytes(32).toString("hex");
  console.warn(
    "⚠ JWT_SECRET no seteado: usando un secreto EFÍMERO aleatorio (solo desarrollo). " +
    "Los tokens se invalidan al reiniciar. Seteá JWT_SECRET en producción."
  );
  return efimero;
}

const JWT_SECRET = resolverJwtSecret();

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
