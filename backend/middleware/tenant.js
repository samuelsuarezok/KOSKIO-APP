// middleware/tenant.js — Resuelve el tenant y carga su BD en cada request

const { cargarTenantDb } = require("../db/tenantDb");
const { getMasterDb }    = require("../db/masterDb");

/**
 * Middleware que se ejecuta DESPUÉS de verificarToken.
 * Lee tenant_id del JWT, verifica que esté activo y carga su BD en req.tenantDb.
 */
function resolverTenant(req, res, next) {
  const tenantId = req.usuario?.tenant_id;

  if (!tenantId) {
    return res.status(400).json({ success: false, mensaje: "Token sin tenant asociado." });
  }

  // Verificar que el tenant existe y está activo en la master DB
  const master = getMasterDb();
  const tenant = master.get("SELECT * FROM tenants WHERE id = ? AND activo = 1", [tenantId]);

  if (!tenant) {
    return res.status(403).json({
      success: false,
      mensaje: "Tu negocio fue desactivado o no existe. Contactá soporte.",
    });
  }

  // Verificar vencimiento
  if (tenant.fecha_vencimiento) {
    const hoy = new Date().toISOString().split("T")[0];
    if (tenant.fecha_vencimiento < hoy) {
      return res.status(403).json({
        success: false,
        mensaje: "Tu suscripción venció. Renová tu plan para continuar.",
        vencido: true,
      });
    }
  }

  // Cargar la BD del tenant
  const tenantDb = cargarTenantDb(tenantId);
  if (!tenantDb) {
    return res.status(500).json({ success: false, mensaje: "Error al cargar la base de datos del negocio." });
  }

  // Adjuntar al request para que las rutas lo usen
  req.tenantDb = tenantDb;
  req.tenant   = tenant;
  next();
}

module.exports = { resolverTenant };
