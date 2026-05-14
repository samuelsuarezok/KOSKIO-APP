// server.js - Servidor principal POS Argentina

const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDatabase } = require("./db/database");

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir el frontend estático
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.use("/api/productos", require("./routes/productos"));
app.use("/api/ventas", require("./routes/ventas"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.use((err, req, res, next) => {
  console.error("Error no manejado:", err.stack);
  res.status(500).json({ success: false, mensaje: "Error interno del servidor" });
});

// Inicializar BD (async) y luego arrancar el servidor
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log("\n╔════════════════════════════════════════╗");
    console.log("║       🏪 POS ARGENTINA v1.0.0          ║");
    console.log("╠════════════════════════════════════════╣");
    console.log(`║  → http://localhost:${PORT}              ║`);
    console.log("╠════════════════════════════════════════╣");
    console.log("║  Endpoints:                            ║");
    console.log("║  GET/POST  /api/productos              ║");
    console.log("║  GET       /api/productos/barcode/:cod ║");
    console.log("║  PUT/DEL   /api/productos/:id          ║");
    console.log("║  GET/POST  /api/ventas                 ║");
    console.log("╚════════════════════════════════════════╝\n");
  });
}).catch(err => {
  console.error("❌ Error fatal al inicializar la BD:", err);
  process.exit(1);
});

module.exports = app;
