// routes/auth.js
// Endpoints de autenticación y gestión de usuarios

const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { getDb } = require("../db/database");
const { verificarToken, soloAdmin, JWT_SECRET } = require("../middleware/auth");

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
// Login: valida credenciales y devuelve un JWT
router.post("/login", (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ success: false, mensaje: "Usuario y contraseña requeridos." });
  }

  try {
    const db = getDb();
    const user = db.get(
      "SELECT * FROM usuarios WHERE usuario = ? AND activo = 1",
      [usuario.trim().toLowerCase()]
    );

    if (!user) {
      return res.status(401).json({ success: false, mensaje: "Usuario o contraseña incorrectos." });
    }

    const passwordValida = bcrypt.compareSync(password, user.password_hash);
    if (!passwordValida) {
      return res.status(401).json({ success: false, mensaje: "Usuario o contraseña incorrectos." });
    }

    // Generar token JWT con expiración de 12 horas
    const token = jwt.sign(
      { id: user.id, nombre: user.nombre, usuario: user.usuario, rol: user.rol },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    // Registrar último acceso
    db.run("UPDATE usuarios SET ultimo_acceso = datetime('now','localtime') WHERE id = ?", [user.id]);

    console.log(`✅ Login: ${user.nombre} (${user.rol}) — ${new Date().toLocaleString("es-AR")}`);

    res.json({
      success: true,
      token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        usuario: user.usuario,
        rol: user.rol,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────
// Devuelve los datos del usuario autenticado (para verificar sesión al recargar)
router.get("/me", verificarToken, (req, res) => {
  res.json({ success: true, usuario: req.usuario });
});

// ─── GET /api/auth/usuarios ───────────────────────────────────────────────────
// Listar todos los usuarios (solo admin)
router.get("/usuarios", verificarToken, soloAdmin, (req, res) => {
  try {
    const db = getDb();
    const usuarios = db.all(
      "SELECT id, nombre, usuario, rol, activo, creado_en, ultimo_acceso FROM usuarios ORDER BY nombre ASC"
    );
    res.json({ success: true, data: usuarios });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/auth/usuarios ──────────────────────────────────────────────────
// Crear nuevo usuario (solo admin)
router.post("/usuarios", verificarToken, soloAdmin, (req, res) => {
  const { nombre, usuario, password, rol } = req.body;

  if (!nombre || !usuario || !password || !rol) {
    return res.status(400).json({ success: false, mensaje: "Todos los campos son requeridos." });
  }
  if (!["admin", "cajero"].includes(rol)) {
    return res.status(400).json({ success: false, mensaje: "Rol inválido. Debe ser 'admin' o 'cajero'." });
  }
  if (password.length < 4) {
    return res.status(400).json({ success: false, mensaje: "La contraseña debe tener al menos 4 caracteres." });
  }

  try {
    const db = getDb();

    const existe = db.get("SELECT id FROM usuarios WHERE usuario = ?", [usuario.trim().toLowerCase()]);
    if (existe) {
      return res.status(409).json({ success: false, mensaje: `El usuario "${usuario}" ya existe.` });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.run(
      "INSERT INTO usuarios (nombre, usuario, password_hash, rol) VALUES (?, ?, ?, ?)",
      [nombre.trim(), usuario.trim().toLowerCase(), hash, rol]
    );
    const id = db.lastInsertRowid();

    res.status(201).json({
      success: true,
      mensaje: `Usuario "${nombre}" creado exitosamente.`,
      data: { id, nombre, usuario: usuario.toLowerCase(), rol },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── PUT /api/auth/usuarios/:id ───────────────────────────────────────────────
// Editar usuario (solo admin)
router.put("/usuarios/:id", verificarToken, soloAdmin, (req, res) => {
  const { nombre, usuario, password, rol, activo } = req.body;
  const { id } = req.params;

  // No permitir que el admin se quite el rol a sí mismo
  if (parseInt(id) === req.usuario.id && rol !== "admin") {
    return res.status(400).json({ success: false, mensaje: "No podés quitarte el rol de administrador a vos mismo." });
  }

  try {
    const db = getDb();
    const user = db.get("SELECT * FROM usuarios WHERE id = ?", [id]);
    if (!user) return res.status(404).json({ success: false, mensaje: "Usuario no encontrado." });

    // Verificar unicidad del username (excluyendo el propio)
    const dupe = db.get("SELECT id FROM usuarios WHERE usuario = ? AND id != ?", [usuario.trim().toLowerCase(), id]);
    if (dupe) {
      return res.status(409).json({ success: false, mensaje: `El usuario "${usuario}" ya está en uso.` });
    }

    // Si se envía nueva contraseña, hashearla
    let nuevoHash = user.password_hash;
    if (password && password.trim().length > 0) {
      if (password.length < 4) {
        return res.status(400).json({ success: false, mensaje: "La contraseña debe tener al menos 4 caracteres." });
      }
      nuevoHash = bcrypt.hashSync(password, 10);
    }

    db.run(
      `UPDATE usuarios SET nombre=?, usuario=?, password_hash=?, rol=?, activo=? WHERE id=?`,
      [nombre.trim(), usuario.trim().toLowerCase(), nuevoHash, rol, activo ? 1 : 0, id]
    );

    res.json({ success: true, mensaje: "Usuario actualizado exitosamente." });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── DELETE /api/auth/usuarios/:id ────────────────────────────────────────────
// Eliminar usuario (solo admin, no puede eliminarse a sí mismo)
router.delete("/usuarios/:id", verificarToken, soloAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.usuario.id) {
    return res.status(400).json({ success: false, mensaje: "No podés eliminarte a vos mismo." });
  }
  try {
    const db = getDb();
    const user = db.get("SELECT id FROM usuarios WHERE id = ?", [req.params.id]);
    if (!user) return res.status(404).json({ success: false, mensaje: "Usuario no encontrado." });

    db.run("DELETE FROM usuarios WHERE id = ?", [req.params.id]);
    res.json({ success: true, mensaje: "Usuario eliminado exitosamente." });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
