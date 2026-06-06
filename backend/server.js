// server.js — KOSKIO APP v1.4.0

const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const { initDatabase }            = require("./db/database");
const { verificarToken }          = require("./middleware/auth");
const { iniciarBackupAutomatico } = require("./services/backupService");

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Rutas públicas
app.use("/api/auth",   require("./routes/auth"));

// Rutas protegidas
app.use("/api/config",    verificarToken, require("./routes/config"));
app.use("/api/productos", verificarToken, require("./routes/productos"));
app.use("/api/ventas",    verificarToken, require("./routes/ventas"));
app.use("/api/caja",      verificarToken, require("./routes/caja"));
app.use("/api/backup",    verificarToken, require("./routes/backup"));

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"))
);

app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
});

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║         🏪 KOSKIO APP v1.4.0           ║");
    console.log("╠════════════════════════════════════════╣");
    console.log(`║  → http://localhost:${PORT}              ║`);
    console.log("╚════════════════════════════════════════╝\n");
    iniciarBackupAutomatico();
  });
}).catch(err => { console.error("❌ Error fatal:", err); process.exit(1); });

module.exports = app;
