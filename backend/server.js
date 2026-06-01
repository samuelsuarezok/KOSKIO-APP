// server.js - Servidor principal KOSKIO APP con autenticación JWT

const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDatabase } = require("./db/database");
const { verificarToken } = require("./middleware/auth");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir el frontend estático
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ─── Rutas públicas (no requieren token) ──────────────────────────────────────
app.use("/api/auth", require("./routes/auth"));

// ─── Rutas protegidas (requieren token JWT válido) ────────────────────────────
app.use("/api/productos", verificarToken, require("./routes/productos"));
app.use("/api/ventas",    verificarToken, require("./routes/ventas"));

// Ruta raíz: sirve el frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error("Error no manejado:", err.stack);
  res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
});

// Inicializar BD y arrancar servidor
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║       🏪 KOSKIO APP v1.1.0          ║");
    console.log("╠════════════════════════════════════════╣");
    console.log(`║  → http://localhost:${PORT}              ║`);
    console.log("╠════════════════════════════════════════╣");
    console.log("║  Auth: POST /api/auth/login            ║");
    console.log("║  Productos: /api/productos (🔒)        ║");
    console.log("║  Ventas: /api/ventas (🔒)              ║");
    console.log("╚════════════════════════════════════════╝\n");
  });
}).catch(err => {
  console.error("❌ Error fatal:", err);
  process.exit(1);
});

module.exports = app;
