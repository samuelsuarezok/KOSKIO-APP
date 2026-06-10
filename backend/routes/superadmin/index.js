// routes/superadmin/index.js — Panel de control de la plataforma

const express  = require("express");
const router   = express.Router();
const bcrypt   = require("bcryptjs");
const { getMasterDb }                     = require("../../db/masterDb");
const { cargarTenantDb, listarTenantDbs } = require("../../db/tenantDb");
const { generarTokenSA, verificarSuperAdmin } = require("../../middleware/superauth");

// ─── POST /api/superadmin/login ───────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password)
    return res.status(400).json({ success: false, mensaje: "Usuario y contraseña requeridos." });

  try {
    const master = getMasterDb();
    const sa = master.get("SELECT * FROM superadmins WHERE usuario = ?", [usuario.trim().toLowerCase()]);
    if (!sa || !bcrypt.compareSync(password, sa.password_hash))
      return res.status(401).json({ success: false, mensaje: "Credenciales incorrectas." });

    const token = generarTokenSA(sa);
    console.log(`👑 SuperAdmin login: ${sa.nombre}`);
    res.json({ success: true, token, superadmin: { id: sa.id, nombre: sa.nombre, usuario: sa.usuario } });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/superadmin/me ───────────────────────────────────────────────────
router.get("/me", verificarSuperAdmin, (req, res) => {
  res.json({ success: true, superadmin: req.superadmin });
});

// ─── GET /api/superadmin/dashboard ───────────────────────────────────────────
// Métricas generales de la plataforma
router.get("/dashboard", verificarSuperAdmin, (req, res) => {
  try {
    const master = getMasterDb();
    const hoy    = new Date().toISOString().split("T")[0];
    const mesActual = hoy.slice(0, 7); // YYYY-MM

    const totalTenants   = master.get("SELECT COUNT(*) as c FROM tenants")?.c || 0;
    const activosTenants = master.get("SELECT COUNT(*) as c FROM tenants WHERE activo = 1")?.c || 0;
    const vencidosTenants= master.get("SELECT COUNT(*) as c FROM tenants WHERE fecha_vencimiento < ? AND activo = 1", [hoy])?.c || 0;
    const nuevosEsteMes  = master.get("SELECT COUNT(*) as c FROM tenants WHERE creado_en LIKE ?", [`${mesActual}%`])?.c || 0;

    // Ingresos del mes (pagos confirmados)
    const ingresosMes = master.get(
      "SELECT COALESCE(SUM(monto), 0) as total FROM pagos WHERE estado = 'confirmado' AND creado_en LIKE ?",
      [`${mesActual}%`]
    )?.total || 0;

    // Tenants por plan
    const porPlan = master.all(`
      SELECT p.nombre as plan, COUNT(t.id) as cantidad
      FROM tenants t JOIN planes p ON t.plan_id = p.id
      WHERE t.activo = 1
      GROUP BY t.plan_id ORDER BY cantidad DESC
    `);

    // Últimos 5 registros
    const ultimosRegistros = master.all(`
      SELECT t.*, p.nombre as plan_nombre
      FROM tenants t JOIN planes p ON t.plan_id = p.id
      ORDER BY t.creado_en DESC LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        tenants: { total: totalTenants, activos: activosTenants, vencidos: vencidosTenants, nuevos_mes: nuevosEsteMes },
        ingresos_mes: ingresosMes,
        por_plan: porPlan,
        ultimos_registros: ultimosRegistros,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/superadmin/tenants ─────────────────────────────────────────────
// Listar todos los negocios con filtros
router.get("/tenants", verificarSuperAdmin, (req, res) => {
  try {
    const master = getMasterDb();
    const { buscar, plan_id, activo } = req.query;

    let where = "WHERE 1=1";
    const params = [];
    if (buscar) { where += " AND (t.nombre LIKE ? OR t.codigo LIKE ? OR t.email_contacto LIKE ?)"; params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`); }
    if (plan_id) { where += " AND t.plan_id = ?"; params.push(plan_id); }
    if (activo !== undefined) { where += " AND t.activo = ?"; params.push(activo === "1" ? 1 : 0); }

    const tenants = master.all(`
      SELECT t.*, p.nombre as plan_nombre, p.precio_mensual
      FROM tenants t JOIN planes p ON t.plan_id = p.id
      ${where}
      ORDER BY t.creado_en DESC
    `, params);

    // Agregar métricas básicas de cada tenant desde su BD
    const hoy = new Date().toISOString().split("T")[0];
    const enriched = tenants.map(t => {
      const vencido = t.fecha_vencimiento && t.fecha_vencimiento < hoy;
      let ventas_mes = 0, usuarios = 0;
      try {
        const tdb = cargarTenantDb(t.id);
        if (tdb) {
          const mesActual = hoy.slice(0, 7);
          ventas_mes = tdb.get(`SELECT COUNT(*) as c FROM ventas WHERE creado_en LIKE ?`, [`${mesActual}%`])?.c || 0;
          usuarios   = tdb.get(`SELECT COUNT(*) as c FROM usuarios WHERE activo = 1`)?.c || 0;
        }
      } catch (_) {}
      return { ...t, vencido, ventas_mes, usuarios };
    });

    res.json({ success: true, data: enriched, total: enriched.length });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/superadmin/tenants/:id ─────────────────────────────────────────
// Detalle completo de un tenant
router.get("/tenants/:id", verificarSuperAdmin, (req, res) => {
  try {
    const master = getMasterDb();
    const tenant = master.get(`
      SELECT t.*, p.nombre as plan_nombre, p.precio_mensual, p.max_productos, p.max_usuarios, p.max_ventas_mes
      FROM tenants t JOIN planes p ON t.plan_id = p.id
      WHERE t.id = ?
    `, [req.params.id]);

    if (!tenant) return res.status(404).json({ success: false, mensaje: "Tenant no encontrado." });

    const hoy = new Date().toISOString().split("T")[0];
    const mesActual = hoy.slice(0, 7);

    let detalle = { tenant, usuarios: [], ventas_mes: 0, productos: 0, ultima_venta: null };

    try {
      const tdb = cargarTenantDb(tenant.id);
      if (tdb) {
        detalle.usuarios    = tdb.all("SELECT id, nombre, usuario, rol, activo, ultimo_acceso FROM usuarios ORDER BY nombre");
        detalle.ventas_mes  = tdb.get(`SELECT COUNT(*) as c, COALESCE(SUM(total),0) as monto FROM ventas WHERE creado_en LIKE ?`, [`${mesActual}%`]) || { c: 0, monto: 0 };
        detalle.productos   = tdb.get("SELECT COUNT(*) as c FROM productos")?.c || 0;
        detalle.ultima_venta= tdb.get("SELECT creado_en, total FROM ventas ORDER BY creado_en DESC LIMIT 1");
        detalle.config      = (() => {
          const rows = tdb.all("SELECT clave, valor FROM configuracion");
          const obj = {}; rows.forEach(r => { obj[r.clave] = r.valor; }); return obj;
        })();
      }
    } catch (_) {}

    // Historial de pagos
    detalle.pagos = master.all("SELECT * FROM pagos WHERE tenant_id = ? ORDER BY creado_en DESC LIMIT 10", [tenant.id]);

    res.json({ success: true, data: detalle });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── PUT /api/superadmin/tenants/:id ─────────────────────────────────────────
// Modificar un tenant (plan, vencimiento, estado)
router.put("/tenants/:id", verificarSuperAdmin, (req, res) => {
  const { activo, plan_id, fecha_vencimiento, nombre, email_contacto, telefono } = req.body;
  try {
    const master = getMasterDb();
    const tenant = master.get("SELECT id FROM tenants WHERE id = ?", [req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, mensaje: "Tenant no encontrado." });

    const campos = [];
    const vals   = [];

    if (activo !== undefined)          { campos.push("activo = ?");            vals.push(activo ? 1 : 0); }
    if (plan_id)                       { campos.push("plan_id = ?");           vals.push(plan_id); }
    if (fecha_vencimiento)             { campos.push("fecha_vencimiento = ?"); vals.push(fecha_vencimiento); }
    if (nombre)                        { campos.push("nombre = ?");            vals.push(nombre.trim()); }
    if (email_contacto !== undefined)  { campos.push("email_contacto = ?");    vals.push(email_contacto); }
    if (telefono !== undefined)        { campos.push("telefono = ?");          vals.push(telefono); }

    if (!campos.length)
      return res.status(400).json({ success: false, mensaje: "No hay campos para actualizar." });

    campos.push("actualizado_en = datetime('now','localtime')");
    vals.push(req.params.id);

    master.run(`UPDATE tenants SET ${campos.join(", ")} WHERE id = ?`, vals);
    console.log(`👑 Tenant #${req.params.id} actualizado por ${req.superadmin.nombre}`);
    res.json({ success: true, mensaje: "Tenant actualizado exitosamente." });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/superadmin/tenants/:id/extender ───────────────────────────────
// Extender vencimiento N días
router.post("/tenants/:id/extender", verificarSuperAdmin, (req, res) => {
  const { dias } = req.body;
  if (!dias || dias <= 0)
    return res.status(400).json({ success: false, mensaje: "Indicá la cantidad de días." });
  try {
    const master = getMasterDb();
    const tenant = master.get("SELECT * FROM tenants WHERE id = ?", [req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, mensaje: "Tenant no encontrado." });

    // Extender desde el vencimiento actual (o desde hoy si ya venció)
    const base = tenant.fecha_vencimiento && tenant.fecha_vencimiento > new Date().toISOString().split("T")[0]
      ? new Date(tenant.fecha_vencimiento)
      : new Date();
    base.setDate(base.getDate() + parseInt(dias));
    const nuevaFecha = base.toISOString().split("T")[0];

    master.run("UPDATE tenants SET fecha_vencimiento = ?, activo = 1, actualizado_en = datetime('now','localtime') WHERE id = ?",
      [nuevaFecha, req.params.id]);

    console.log(`👑 Tenant #${req.params.id} extendido ${dias} días → ${nuevaFecha}`);
    res.json({ success: true, mensaje: `Plan extendido hasta el ${nuevaFecha}.`, nueva_fecha: nuevaFecha });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/superadmin/planes ───────────────────────────────────────────────
router.get("/planes", verificarSuperAdmin, (req, res) => {
  try {
    const planes = getMasterDb().all("SELECT * FROM planes ORDER BY precio_mensual ASC");
    res.json({ success: true, data: planes });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/superadmin/pagos ───────────────────────────────────────────────
// Registrar un pago manualmente
router.post("/pagos", verificarSuperAdmin, (req, res) => {
  const { tenant_id, monto, medio, referencia_pago, dias_extension } = req.body;
  if (!tenant_id || !monto)
    return res.status(400).json({ success: false, mensaje: "tenant_id y monto son requeridos." });
  try {
    const master = getMasterDb();
    const tenant = master.get("SELECT * FROM tenants WHERE id = ?", [tenant_id]);
    if (!tenant) return res.status(404).json({ success: false, mensaje: "Tenant no encontrado." });

    const hoy = new Date().toISOString().split("T")[0];
    const mesActual = hoy.slice(0, 7);

    master.run(
      `INSERT INTO pagos (tenant_id, monto, medio, referencia_pago, estado, periodo_desde, periodo_hasta)
       VALUES (?, ?, ?, ?, 'confirmado', ?, ?)`,
      [tenant_id, monto, medio || "manual", referencia_pago || null,
       `${mesActual}-01`, `${mesActual}-31`]
    );

    // Extender automáticamente si se indicaron días
    if (dias_extension && dias_extension > 0) {
      const base = tenant.fecha_vencimiento && tenant.fecha_vencimiento > hoy
        ? new Date(tenant.fecha_vencimiento) : new Date();
      base.setDate(base.getDate() + parseInt(dias_extension));
      const nuevaFecha = base.toISOString().split("T")[0];
      master.run("UPDATE tenants SET fecha_vencimiento = ?, activo = 1 WHERE id = ?", [nuevaFecha, tenant_id]);
    }

    console.log(`💰 Pago registrado: Tenant #${tenant_id} | $${monto} | ${medio || "manual"}`);
    res.status(201).json({ success: true, mensaje: "Pago registrado exitosamente." });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
