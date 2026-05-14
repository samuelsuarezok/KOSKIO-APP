// routes/productos.js - CRUD completo de productos (usa sql.js síncrono)

const express = require("express");
const router = express.Router();
const { getDb } = require("../db/database");

// GET /api/productos — listar todos (con búsqueda opcional)
router.get("/", (req, res) => {
  try {
    const { buscar } = req.query;
    const db = getDb();
    let rows;
    if (buscar) {
      rows = db.all(
        "SELECT * FROM productos WHERE nombre LIKE ? OR codigo_barras LIKE ? ORDER BY nombre ASC",
        [`%${buscar}%`, `%${buscar}%`]
      );
    } else {
      rows = db.all("SELECT * FROM productos ORDER BY nombre ASC");
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// GET /api/productos/barcode/:codigo — buscar por código de barras (POS scanner)
router.get("/barcode/:codigo", (req, res) => {
  try {
    const db = getDb();
    const row = db.get("SELECT * FROM productos WHERE codigo_barras = ?", [req.params.codigo]);
    if (!row) return res.status(404).json({ success: false, mensaje: "Producto no encontrado" });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// GET /api/productos/:id
router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const row = db.get("SELECT * FROM productos WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ success: false, mensaje: "Producto no encontrado" });
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// POST /api/productos — crear producto
router.post("/", (req, res) => {
  try {
    const { codigo_barras, nombre, precio, stock } = req.body;
    if (!codigo_barras || !nombre || precio === undefined) {
      return res.status(400).json({ success: false, mensaje: "Campos requeridos: codigo_barras, nombre, precio" });
    }
    if (precio < 0) {
      return res.status(400).json({ success: false, mensaje: "El precio no puede ser negativo" });
    }
    const db = getDb();

    // Verificar unicidad
    const existe = db.get("SELECT id FROM productos WHERE codigo_barras = ?", [codigo_barras.trim()]);
    if (existe) {
      return res.status(409).json({ success: false, mensaje: `Ya existe un producto con el código: ${codigo_barras}` });
    }

    db.run(
      "INSERT INTO productos (codigo_barras, nombre, precio, stock) VALUES (?, ?, ?, ?)",
      [codigo_barras.trim(), nombre.trim(), precio, stock || 0]
    );
    const id = db.lastInsertRowid();
    res.status(201).json({
      success: true,
      mensaje: "Producto creado exitosamente",
      data: { id, codigo_barras, nombre, precio, stock: stock || 0 },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// PUT /api/productos/:id — actualizar producto
router.put("/:id", (req, res) => {
  try {
    const { codigo_barras, nombre, precio, stock } = req.body;
    const { id } = req.params;
    if (!codigo_barras || !nombre || precio === undefined) {
      return res.status(400).json({ success: false, mensaje: "Campos requeridos: codigo_barras, nombre, precio" });
    }
    const db = getDb();

    // Verificar que existe
    const existe = db.get("SELECT id FROM productos WHERE id = ?", [id]);
    if (!existe) return res.status(404).json({ success: false, mensaje: "Producto no encontrado" });

    // Verificar unicidad del código (excluyendo el propio)
    const dupe = db.get("SELECT id FROM productos WHERE codigo_barras = ? AND id != ?", [codigo_barras.trim(), id]);
    if (dupe) {
      return res.status(409).json({ success: false, mensaje: `Otro producto ya tiene el código: ${codigo_barras}` });
    }

    db.run(
      `UPDATE productos SET codigo_barras=?, nombre=?, precio=?, stock=?, actualizado_en=datetime('now','localtime') WHERE id=?`,
      [codigo_barras.trim(), nombre.trim(), precio, stock ?? 0, id]
    );
    res.json({ success: true, mensaje: "Producto actualizado exitosamente" });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// DELETE /api/productos/:id — eliminar producto
router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const existe = db.get("SELECT id FROM productos WHERE id = ?", [req.params.id]);
    if (!existe) return res.status(404).json({ success: false, mensaje: "Producto no encontrado" });
    db.run("DELETE FROM productos WHERE id = ?", [req.params.id]);
    res.json({ success: true, mensaje: "Producto eliminado exitosamente" });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
