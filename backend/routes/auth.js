// routes/auth.js — Login con código de negocio + gestión de usuarios

const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const { getMasterDb }                   = require("../db/masterDb");
const { cargarTenantDb, crearTenantDb } = require("../db/tenantDb");
const { verificarToken, soloAdmin, JWT_SECRET } = require("../middleware/auth");
const { resolverTenant } = require("../middleware/tenant");

// ─── POST /api/auth/login ────────────────────────────────────────────────────
// Requiere: codigo_negocio + usuario + password
router.post("/login", (req, res) => {
  const { codigo_negocio, usuario, password } = req.body;

  if (!codigo_negocio || !usuario || !password) {
    return res.status(400).json({
      success: false,
      mensaje: "Código de negocio, usuario y contraseña son requeridos.",
    });
  }

  try {
    const master = getMasterDb();

    // 1. Buscar tenant por código
    const tenant = master.get(
      "SELECT * FROM tenants WHERE codigo = ? AND activo = 1",
      [codigo_negocio.trim().toUpperCase()]
    );
    if (!tenant) {
      return res.status(401).json({
        success: false,
        mensaje: "Código de negocio no encontrado o desactivado.",
      });
    }

    // 2. Verificar vencimiento
    if (tenant.fecha_vencimiento) {
      const hoy = new Date().toISOString().split("T")[0];
      if (tenant.fecha_vencimiento < hoy) {
        return res.status(403).json({
          success: false,
          mensaje: "La suscripción de este negocio venció. Contactá al administrador.",
          vencido: true,
        });
      }
    }

    // 3. Cargar BD del tenant
    const tenantDb = cargarTenantDb(tenant.id);
    if (!tenantDb) {
      return res.status(500).json({ success: false, mensaje: "Error interno al cargar el negocio." });
    }

    // 4. Buscar usuario dentro de la BD del tenant
    const user = tenantDb.get(
      "SELECT * FROM usuarios WHERE usuario = ? AND activo = 1",
      [usuario.trim().toLowerCase()]
    );
    if (!user) {
      return res.status(401).json({ success: false, mensaje: "Usuario o contraseña incorrectos." });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ success: false, mensaje: "Usuario o contraseña incorrectos." });
    }

    // 5. Generar JWT con tenant_id
    const token = jwt.sign(
      {
        id:            user.id,
        nombre:        user.nombre,
        usuario:       user.usuario,
        rol:           user.rol,
        tenant_id:     tenant.id,
        tenant_codigo: tenant.codigo,
        tenant_nombre: tenant.nombre,
      },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    // 6. Registrar último acceso
    tenantDb.run("UPDATE usuarios SET ultimo_acceso = datetime('now','localtime') WHERE id = ?", [user.id]);

    console.log(`✅ Login: ${user.nombre} (${user.rol}) → ${tenant.nombre} [${tenant.codigo}]`);

    res.json({
      success: true,
      token,
      usuario: {
        id:            user.id,
        nombre:        user.nombre,
        usuario:       user.usuario,
        rol:           user.rol,
        tenant_id:     tenant.id,
        tenant_codigo: tenant.codigo,
        tenant_nombre: tenant.nombre,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/auth/registro ─────────────────────────────────────────────────
// Registrar un nuevo negocio (crea tenant + admin)
router.post("/registro", (req, res) => {
  const { negocio_nombre, admin_nombre, admin_usuario, admin_password, email, telefono } = req.body;

  if (!negocio_nombre || !admin_nombre || !admin_usuario || !admin_password) {
    return res.status(400).json({
      success: false,
      mensaje: "Campos requeridos: nombre del negocio, nombre del admin, usuario y contraseña.",
    });
  }
  if (admin_password.length < 8) {
    return res.status(400).json({ success: false, mensaje: "La contraseña debe tener al menos 8 caracteres." });
  }

  try {
    const master = getMasterDb();

    // Generar código único para el negocio
    let codigo;
    let intentos = 0;
    do {
      codigo = _generarCodigo(negocio_nombre);
      intentos++;
    } while (master.get("SELECT id FROM tenants WHERE codigo = ?", [codigo]) && intentos < 50);

    if (intentos >= 50) throw new Error("No se pudo generar un código único.");

    // Crear tenant en la master DB (plan gratuito por defecto)
    // Vencimiento: 30 días desde hoy
    const vencimiento = new Date();
    vencimiento.setDate(vencimiento.getDate() + 30);
    const fechaVto = vencimiento.toISOString().split("T")[0];

    master.run(
      `INSERT INTO tenants (codigo, nombre, email_contacto, telefono, plan_id, fecha_vencimiento)
       VALUES (?, ?, ?, ?, 1, ?)`,
      [codigo, negocio_nombre.trim(), email || null, telefono || null, fechaVto]
    );
    const tenantId = master.lastId();

    // Crear BD del tenant con el admin
    const hash = bcrypt.hashSync(admin_password, 10);
    crearTenantDb(tenantId, negocio_nombre.trim(), admin_nombre.trim(), admin_usuario.trim().toLowerCase(), hash);

    console.log(`🎉 Nuevo negocio registrado: ${negocio_nombre} [${codigo}] — Admin: ${admin_usuario}`);

    res.status(201).json({
      success: true,
      mensaje: "¡Negocio registrado exitosamente!",
      data: {
        codigo,
        nombre:           negocio_nombre,
        admin_usuario:    admin_usuario.toLowerCase(),
        plan:             "Gratuito (30 días de prueba)",
        fecha_vencimiento: fechaVto,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get("/me", verificarToken, (req, res) => {
  res.json({ success: true, usuario: req.usuario });
});

// ─── RUTAS DE USUARIOS (requieren token + tenant) ─────────────────────────────

// GET /api/auth/usuarios
router.get("/usuarios", verificarToken, resolverTenant, soloAdmin, (req, res) => {
  try {
    const usuarios = req.tenantDb.all(
      "SELECT id, nombre, usuario, rol, activo, creado_en, ultimo_acceso FROM usuarios ORDER BY nombre ASC"
    );
    res.json({ success: true, data: usuarios });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// POST /api/auth/usuarios
router.post("/usuarios", verificarToken, resolverTenant, soloAdmin, (req, res) => {
  const { nombre, usuario, password, rol } = req.body;
  if (!nombre || !usuario || !password || !rol) {
    return res.status(400).json({ success: false, mensaje: "Todos los campos son requeridos." });
  }
  if (!["admin", "cajero"].includes(rol)) {
    return res.status(400).json({ success: false, mensaje: "Rol inválido." });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, mensaje: "La contraseña debe tener al menos 8 caracteres." });
  }
  try {
    const db = req.tenantDb;
    const existe = db.get("SELECT id FROM usuarios WHERE usuario = ?", [usuario.trim().toLowerCase()]);
    if (existe) return res.status(409).json({ success: false, mensaje: `El usuario "${usuario}" ya existe.` });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?,?,?,?)",
      [nombre.trim(), usuario.trim().toLowerCase(), hash, rol]);
    const id = db.lastInsertRowid();
    res.status(201).json({ success: true, mensaje: `Usuario "${nombre}" creado.`, data: { id, nombre, usuario: usuario.toLowerCase(), rol } });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// PUT /api/auth/usuarios/:id
router.put("/usuarios/:id", verificarToken, resolverTenant, soloAdmin, (req, res) => {
  const { nombre, usuario, password, rol, activo } = req.body;
  const { id } = req.params;
  if (parseInt(id) === req.usuario.id && rol !== "admin") {
    return res.status(400).json({ success: false, mensaje: "No podés quitarte el rol de admin a vos mismo." });
  }
  try {
    const db   = req.tenantDb;
    const user = db.get("SELECT * FROM usuarios WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ success: false, mensaje: "Usuario no encontrado." });

    const dupe = db.get("SELECT id FROM usuarios WHERE usuario = ? AND id != ?", [usuario.trim().toLowerCase(), id]);
    if (dupe) return res.status(409).json({ success: false, mensaje: `El usuario "${usuario}" ya está en uso.` });

    let nuevoHash = user.password_hash;
    if (password && password.trim().length > 0) {
      if (password.length < 8) return res.status(400).json({ success: false, mensaje: "Mínimo 8 caracteres." });
      nuevoHash = bcrypt.hashSync(password, 10);
    }

    db.run("UPDATE usuarios SET nombre=?, usuario=?, password_hash=?, rol=?, activo=? WHERE id=?",
      [nombre.trim(), usuario.trim().toLowerCase(), nuevoHash, rol, activo ? 1 : 0, id]);
    res.json({ success: true, mensaje: "Usuario actualizado." });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// DELETE /api/auth/usuarios/:id
router.delete("/usuarios/:id", verificarToken, resolverTenant, soloAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.usuario.id) {
    return res.status(400).json({ success: false, mensaje: "No podés eliminarte a vos mismo." });
  }
  try {
    const db = req.tenantDb;
    const user = db.get("SELECT id FROM usuarios WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ success: false, mensaje: "Usuario no encontrado." });
    db.run("DELETE FROM usuarios WHERE id = ?", [req.params.id]);
    res.json({ success: true, mensaje: "Usuario eliminado." });
  } catch (err) { res.status(500).json({ success: false, mensaje: err.message }); }
});

// ── Helper: generar código de negocio ─────────────────────────────────────────
function _generarCodigo(nombre) {
  // Tomar primeras 3-4 letras del nombre + 3 caracteres alfanuméricos random
  const prefijo = nombre
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4)
    || "NEGO";
  const sufijo = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefijo}-${sufijo}`;
}

module.exports = router;
